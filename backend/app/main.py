"""FastAPI transport boundary for the grounded portfolio chat."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from collections.abc import AsyncGenerator, Callable, Iterator, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from app.application.chat import (
    CHAT_PROTOCOL_VERSION,
    CandidateValidationError,
    build_event_stream,
)
from app.application.chat_admission import ChatAdmissionGuard
from app.application.chat_budget import (
    BudgetConfig,
    BudgetDecision,
    ChatBudgetStore,
    PostgresChatBudgetStore,
    UnavailableChatBudgetStore,
)
from app.application.chat_graph import ChatGraphState, run_chat_graph
from app.application.contact import (
    CONTACT_FORM_VERSION,
    CONTACT_SUBMISSION_VERSION,
    MAX_CONTACT_BODY_BYTES,
    ContactSubmission,
    ContactSubmissionResponse,
    EphemeralSubmissionGuard,
)
from app.domain.content import load_content_bundle
from app.infrastructure.chat_provider import (
    ChatProvider,
    OpenAIChatProvider,
    ProviderFailure,
    ProviderLimits,
    ProviderResult,
    ToolCall,
)
from app.infrastructure.contact_delivery import BrevoContactDelivery, ContactDeliveryFailure
from app.infrastructure.pdf_rag import (
    OpenAIEmbedder,
    PdfRetrievalError,
    PdfRetriever,
    SupabasePdfRetriever,
)

APP_VERSION = "0.1.0"
DEFAULT_ORIGINS = ("http://localhost:4200", "https://portfolio2026.vercel.app")
DEFAULT_PREVIEW_ORIGIN_REGEX = r"^https://portfolio2026(?:-[a-z0-9-]+)?\.vercel\.app$"
_PROVIDER_MESSAGES = {
    "provider-timeout": ("El servicio tardó demasiado. Intentá nuevamente.", True),
    "provider-unavailable": ("El servicio no está disponible. Intentá nuevamente.", True),
    "rate-limited": ("El servicio está temporalmente ocupado. Intentá nuevamente.", True),
    "limit-exceeded": ("La solicitud supera el límite permitido.", False),
    "invalid-provider-output": ("No pude validar la respuesta.", False),
}
_NO_PORTFOLIO_RESULTS_MESSAGE = "No encontré información del portfolio sobre ese tema."
logger = logging.getLogger(__name__)
_STARTUP_STAGES = frozenset(
    {
        "chat_admission",
        "service_token",
        "openai_api_key",
        "content_bundle",
        "budget_config",
        "provider",
        "retriever",
        "budget_store",
    }
)


def _chat_log(event: str, **fields: object) -> None:
    """Write a compact, payload-free chat lifecycle record."""
    logger.info("chat_observability event=%s fields=%s", event, json.dumps(fields, sort_keys=True))


class ChatRequest(BaseModel):
    """Public, Spanish-only request contract."""

    model_config = ConfigDict(extra="forbid", strict=True)

    message: str = Field(min_length=1, max_length=500)
    locale: Literal["es"]
    client_request_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    )
    capabilities: dict[str, Literal["1"]] | None = None


def _sse(events: list[dict[str, object]]) -> Iterator[bytes]:
    """Frame trusted domain events as SSE without exposing partial model text."""
    for payload in events:
        event_type = payload["type"]
        if not isinstance(event_type, str):
            raise TypeError("chat event type must be a string")
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        yield f"event: {event_type}\ndata: {data}\n\n".encode()


def _provider_error(error: ProviderFailure) -> dict[str, object]:
    code = error.code if error.code in _PROVIDER_MESSAGES else "provider-unavailable"
    message, retryable = _PROVIDER_MESSAGES[code]
    return {"code": code, "message": message, "retryable": retryable}


def _failure_diagnostics(
    error: ProviderFailure | CandidateValidationError, usage: Mapping[str, object]
) -> dict[str, object]:
    """Build payload-free failure fields: category, compact summary, total tokens."""
    category = getattr(error, "diagnostic_category", None)
    metadata = getattr(error, "diagnostic_metadata", None)
    if not isinstance(metadata, Mapping):
        metadata = {}
    summary_parts: list[str] = []
    incomplete_reason = metadata.get("incomplete_reason")
    if isinstance(incomplete_reason, str):
        summary_parts.append(f"incomplete_reason={incomplete_reason}")
    item_types = metadata.get("output_item_types")
    if isinstance(item_types, list):
        summary_parts.append(f"output_item_types={item_types}")
    usage_tokens = metadata.get("usage_tokens")
    if isinstance(usage_tokens, Mapping):
        summary_parts.append(f"usage_tokens={json.dumps(usage_tokens, sort_keys=True)}")
    total_input = getattr(error, "total_input_tokens", None)
    total_output = getattr(error, "total_output_tokens", None)
    if isinstance(total_input, int) and isinstance(total_output, int):
        total_tokens: object = total_input + total_output
    else:
        reported = usage.get("total_tokens")
        total_tokens = reported if isinstance(reported, int) else 0
    return {
        "diagnostic_category": category,
        "diagnostic_summary": ";".join(summary_parts),
        "total_tokens": total_tokens,
    }


def _refusal(classification: str) -> dict[str, object]:
    if classification == "unsafe":
        return {
            "code": "unsafe-request",
            "message": "No puedo ayudar con esa solicitud.",
            "retryable": False,
        }
    return {
        "code": "unsupported-request",
        "message": "No cuento con información aprobada para responder eso.",
        "retryable": False,
    }


def _configured_origins(value: str | None) -> tuple[str, ...]:
    """Read exact CORS origins from an environment value without enabling wildcards."""
    origins = tuple(
        origin.strip()
        for origin in (value or "").split(",")
        if origin.strip() and origin.strip() != "*"
    )
    return origins or DEFAULT_ORIGINS


def _configured_preview_origin_regex(value: str | None) -> str:
    return value if value and "*" not in value else DEFAULT_PREVIEW_ORIGIN_REGEX


def create_app(
    *,
    retriever: PdfRetriever | None = None,
    content_version: str | None = None,
    provider: ChatProvider | None = None,
    provider_model: str = "fake",
    app_version: str = APP_VERSION,
    allowed_origins: tuple[str, ...] = DEFAULT_ORIGINS,
    preview_origin_regex: str = DEFAULT_PREVIEW_ORIGIN_REGEX,
    ready: bool | None = None,
    debug: bool = False,
    contact_enabled: bool = False,
    contact_delivery: object | None = None,
    contact_guard: EphemeralSubmissionGuard | None = None,
    chat_admission: ChatAdmissionGuard | None = None,
    service_token: str | None = None,
    budget_store: ChatBudgetStore | None = None,
    budget_config: BudgetConfig | None = None,
) -> FastAPI:
    """Create an injectable app; unavailable dependencies surface only via readiness."""

    is_ready = ready if ready is not None else retriever is not None and provider is not None
    admission_guard = chat_admission or ChatAdmissionGuard()
    effective_budget = budget_config or BudgetConfig()
    shared_budget: ChatBudgetStore = budget_store or UnavailableChatBudgetStore()
    # This is the reviewed static-portfolio compatibility version consumed by the frontend.
    # It deliberately differs from the PDF hash used only to identify the seeded PDF version.
    compatibility_version = content_version or (
        retriever.content_version if retriever else "unavailable"
    )
    app = FastAPI(title="Portfolio API", version=app_version, debug=debug)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allowed_origins),
        allow_origin_regex=preview_origin_regex,
        allow_credentials=False,
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )

    @app.get("/health", tags=["system"])
    async def health():  # type: ignore[no-untyped-def]
        if not is_ready or retriever is None or provider is None:
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        return {
            "status": "ok",
            "app_version": app_version,
            "content_version": compatibility_version,
        }

    @app.get("/api/v1/metadata", tags=["system"])
    @app.get("/metadata", tags=["system"], include_in_schema=False)
    async def metadata():  # type: ignore[no-untyped-def]
        if not is_ready or retriever is None or provider is None:
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        payload: dict[str, object] = {
            "app_version": app_version,
            "content_version": compatibility_version,
            "model": provider_model,
            "protocol_version": CHAT_PROTOCOL_VERSION,
        }
        if contact_enabled and contact_delivery is not None and contact_guard is not None:
            payload["capabilities"] = {
                "interview_contact_form": CONTACT_FORM_VERSION,
                "contact_submission": CONTACT_SUBMISSION_VERSION,
            }
        return payload

    @app.post("/api/v1/chat/stream", tags=["chat"])
    async def stream_chat(chat_request: ChatRequest, request: Request):  # type: ignore[no-untyped-def]
        if not service_token:
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        authorization = request.headers.get("authorization", "")
        expected = f"Bearer {service_token}".encode("utf-8")
        supplied = authorization.encode("utf-8")
        if not hmac.compare_digest(supplied, expected):
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

        request_id = chat_request.client_request_id

        def stream_response(events: list[dict[str, object]]) -> StreamingResponse:
            return StreamingResponse(
                _sse(events),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache, no-transform",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )

        started_at = time.perf_counter()
        peer = request.client.host if request.client else None
        admission = admission_guard.try_admit(peer)
        if not admission.accepted or admission.lease is None:
            _chat_log("chat.admission_rejected", reason=admission.reason)
            retry_after = admission_guard.config.retry_after_seconds
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(retry_after)},
                content={
                    "code": "throttled",
                    "message": (
                        "El servicio está temporalmente ocupado. "
                        "Intentá nuevamente en unos segundos."
                    ),
                    "retryable": True,
                    "retry_after_seconds": retry_after,
                },
            )
        lease = admission.lease
        _chat_log(
            "chat.request_accepted",
            request_id=request_id,
            client_request_id=chat_request.client_request_id,
            locale=chat_request.locale,
        )
        if not is_ready or retriever is None or provider is None:
            admission_guard.release(lease)
            _chat_log(
                "chat.request_completed",
                request_id=request_id,
                status_code=503,
                terminal_outcome="unavailable",
                elapsed_ms=round((time.perf_counter() - started_at) * 1000),
            )
            return JSONResponse(status_code=503, content={"status": "unavailable"})

        reservation_id = str(uuid.uuid4())
        reservation_at = datetime.now(UTC)
        try:
            budget_decision = await run_in_threadpool(
                shared_budget.reserve,
                reservation_id,
                reservation_at,
                effective_budget.turn_reservation_usd,
            )
        except Exception:
            admission_guard.release(lease)
            _chat_log("chat.budget_store_unavailable", request_id=request_id)
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        if budget_decision is not BudgetDecision.ACCEPTED:
            admission_guard.release(lease)
            _chat_log("chat.monthly_budget_rejected", request_id=request_id)
            return JSONResponse(status_code=429, content={"status": "budget_exceeded"})
        provider_attempted = False
        known_input_tokens: int | None = None
        known_output_tokens: int | None = None

        async def invoke_model(
            message: str,
            evidence: Mapping[str, object] | None = None,
            tool_call: ToolCall | None = None,
            prior_input_tokens: int = 0,
            prior_output_tokens: int = 0,
            on_text_delta: Callable[[str], None] | None = None,
        ) -> ProviderResult:
            nonlocal provider_attempted, known_input_tokens, known_output_tokens
            provider_attempted = True
            # A later in-flight call invalidates counts from earlier completed calls;
            # only a cumulative result from this latest attempt is safe to settle.
            known_input_tokens = known_output_tokens = None
            if isinstance(provider, OpenAIChatProvider):
                call = run_in_threadpool(
                    provider.generate, message, evidence, tool_call, prior_input_tokens,
                    prior_output_tokens, on_text_delta,
                )
            else:
                call = run_in_threadpool(
                    provider.generate, message, evidence, tool_call, prior_input_tokens,
                    prior_output_tokens,
                )
            try:
                result = await call
            except Exception as error:
                input_count = getattr(error, "total_input_tokens", None)
                output_count = getattr(error, "total_output_tokens", None)
                if isinstance(input_count, int) and isinstance(output_count, int):
                    known_input_tokens, known_output_tokens = input_count, output_count
                raise
            known_input_tokens = result.total_input_tokens
            known_output_tokens = result.total_output_tokens
            return result

        state: ChatGraphState = {
            "message": chat_request.message,
            "retriever": retriever,
            "invoke_model": invoke_model,
            "contact_form_supported": bool(
                contact_enabled
                and chat_request.capabilities
                and chat_request.capabilities.get("interview_contact_form") == CONTACT_FORM_VERSION
            ),
        }

        async def response_generator() -> AsyncGenerator[bytes]:
            loop = asyncio.get_running_loop()
            progress: asyncio.Queue[tuple[str, str | None]] = asyncio.Queue(maxsize=128)
            dropped_deltas = 0

            def _offer(item: tuple[str, str | None]) -> None:
                # Runs on the event loop thread: never block, drop newest on overflow.
                nonlocal dropped_deltas
                try:
                    progress.put_nowait(item)
                except asyncio.QueueFull:
                    dropped_deltas += 1

            def on_text_delta(delta: str) -> None:
                # Called from a provider worker thread: hand off without blocking.
                if delta:
                    with contextlib.suppress(RuntimeError):
                        loop.call_soon_threadsafe(_offer, ("text-delta", delta))

            def on_portfolio_search() -> None:
                _chat_log("chat.retrieval_started", request_id=request_id)
                progress.put_nowait(("tool", None))

            def emit(payload: dict[str, object]) -> bytes:
                _chat_log(
                    "chat.sse_event_emitted",
                    request_id=request_id,
                    client_request_id=chat_request.client_request_id,
                    event_type=payload["type"],
                    sequence=payload["sequence"],
                    status_code=200,
                )
                return next(_sse([payload]))

            graph_task: asyncio.Task[ChatGraphState] | None = None
            sequence = 1
            tool_event_emitted = False
            terminal_outcome = "cancelled"
            stream_completed = False
            try:
                state["on_text_delta"] = on_text_delta
                state["on_portfolio_search"] = on_portfolio_search
                _chat_log("chat.graph_started", request_id=request_id)
                graph_task = asyncio.create_task(run_chat_graph(state))
                yield emit(
                    {
                        "request_id": request_id,
                        "sequence": sequence,
                        "type": "start",
                        "protocol_version": CHAT_PROTOCOL_VERSION,
                        "content_version": compatibility_version,
                    }
                )
                while not graph_task.done():
                    try:
                        event_type, delta = await asyncio.wait_for(progress.get(), timeout=0.1)
                    except TimeoutError:
                        continue
                    sequence += 1
                    payload: dict[str, object] = {
                        "request_id": request_id,
                        "sequence": sequence,
                        "type": event_type,
                    }
                    if event_type == "text-delta":
                        payload["text"] = delta or ""
                    else:
                        payload["tool"] = "search_portfolio"
                        tool_event_emitted = True
                    yield emit(payload)

                while not progress.empty():
                    sequence += 1
                    event_type, delta = progress.get_nowait()
                    payload = {"request_id": request_id, "sequence": sequence, "type": event_type}
                    if event_type == "text-delta":
                        payload["text"] = delta or ""
                    else:
                        payload["tool"] = "search_portfolio"
                        tool_event_emitted = True
                    yield emit(payload)

                result = await graph_task
                _chat_log("chat.graph_completed", request_id=request_id)
                portfolio_search_used = result.get("portfolio_search_used", False)
                usage = result.get("usage", {"total_tokens": 0})
                error = result.get("error")
                completion = result.get("completion")
                retrieval_results = result.get("retrieval_results")
                if retrieval_results is not None:
                    _chat_log(
                        "chat.retrieval_completed",
                        request_id=request_id,
                        source_count=len(retrieval_results),
                        page_count=len({item.chunk.page for item in retrieval_results}),
                        outcome="available" if retrieval_results else "empty",
                    )
                if completion is not None and error is None and not result.get("refusal"):
                    _chat_log(
                        "chat.provider_completed", request_id=request_id, model=provider_model
                    )

                if result.get("refusal"):
                    events = build_event_stream(
                        request_id,
                        compatibility_version,
                        refusal=_refusal("unsafe"),
                        portfolio_search_used=portfolio_search_used,
                        model=provider_model,
                        usage=usage,
                    )
                elif isinstance(error, CandidateValidationError):
                    _chat_log(
                        "chat.provider_failed",
                        request_id=request_id,
                        error_code=error.code,
                        retryable=False,
                        **_failure_diagnostics(error, usage),
                    )
                    events = build_event_stream(
                        request_id,
                        compatibility_version,
                        error={"code": error.code, "message": error.message, "retryable": False},
                        portfolio_search_used=portfolio_search_used,
                        model=provider_model,
                        usage=usage,
                    )
                elif isinstance(error, ProviderFailure):
                    public_error = _provider_error(error)
                    _chat_log(
                        "chat.provider_failed",
                        request_id=request_id,
                        error_code=public_error["code"],
                        retryable=public_error["retryable"],
                        **_failure_diagnostics(error, usage),
                    )
                    events = build_event_stream(
                        request_id,
                        compatibility_version,
                        error=public_error,
                        portfolio_search_used=portfolio_search_used,
                        model=provider_model,
                        usage=usage,
                    )
                else:
                    events = build_event_stream(
                        request_id,
                        compatibility_version,
                        validated_parts=result.get("parts", []),
                        portfolio_search_used=portfolio_search_used,
                        model=provider_model,
                        usage=usage,
                    )
                terminal_outcome = next(
                    (
                        event["type"]
                        for event in reversed(events)
                        if event["type"] in {"error", "refusal"}
                    ),
                    "done",
                )
                for event in events[1:]:
                    if event["type"] == "tool" and tool_event_emitted:
                        continue
                    sequence += 1
                    event["sequence"] = sequence
                    yield emit(event)
                stream_completed = True
            except asyncio.CancelledError:
                _chat_log(
                    "chat.stream_cancelled", request_id=request_id, terminal_outcome="cancelled"
                )
                raise
            except Exception:
                terminal_outcome = "internal-error"
                _chat_log(
                    "chat.stream_failed",
                    request_id=request_id,
                    error_code="internal-error",
                    retryable=True,
                )
                sequence += 1
                yield emit(
                    {
                        "request_id": request_id,
                        "sequence": sequence,
                        "type": "error",
                        "code": "provider-unavailable",
                        "message": _PROVIDER_MESSAGES["provider-unavailable"][0],
                        "retryable": True,
                    }
                )
                sequence += 1
                yield emit(
                    {
                        "request_id": request_id,
                        "sequence": sequence,
                        "type": "done",
                        "protocol_version": CHAT_PROTOCOL_VERSION,
                        "content_version": compatibility_version,
                        "model": provider_model,
                        "usage": {"total_tokens": 0},
                    }
                )
            finally:
                if graph_task is not None and not graph_task.done():
                    graph_task.cancel()
                    await asyncio.gather(graph_task, return_exceptions=True)
                try:
                    if not provider_attempted:
                        await run_in_threadpool(shared_budget.release, reservation_id)
                    elif (
                        stream_completed
                        and known_input_tokens is not None
                        and known_output_tokens is not None
                    ):
                        settled, warning, over_reservation = await run_in_threadpool(
                            shared_budget.settle,
                            reservation_id, known_input_tokens, known_output_tokens,
                            effective_budget.input_cost_per_million,
                            effective_budget.output_cost_per_million,
                        )
                        if warning:
                            logger.warning(
                                "chat_observability event=chat.monthly_budget_warning fields=%s",
                                json.dumps(
                                    {"month": reservation_at.strftime("%Y-%m")}, sort_keys=True
                                ),
                            )
                        if over_reservation:
                            logger.error(
                                "chat_observability event=chat.budget_over_reservation fields=%s",
                                json.dumps(
                                    {"request_id": request_id, "settlement_recorded": settled},
                                    sort_keys=True,
                                ),
                            )
                        if not settled:
                            _chat_log("chat.budget_settlement_unconfirmed", request_id=request_id)
                    else:
                        await run_in_threadpool(shared_budget.retain, reservation_id)
                        _chat_log(
                            "chat.budget_reservation_retained_unknown_usage", request_id=request_id
                        )
                except Exception:
                    # If a database response is lost, do not release: the RPC may have committed.
                    _chat_log("chat.budget_accounting_outcome_unknown", request_id=request_id)
                admission_guard.release(lease)
                _chat_log(
                    "chat.stream_completed",
                    request_id=request_id,
                    terminal_outcome=terminal_outcome,
                    elapsed_ms=round((time.perf_counter() - started_at) * 1000),
                    sequence=sequence,
                )

        return StreamingResponse(
            response_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @app.post("/api/v1/contact/submissions", tags=["contact"])
    async def submit_contact(request: Request):  # type: ignore[no-untyped-def]
        request_id = str(uuid.uuid4())

        def response(
            status: int,
            outcome: str,
            retryable: bool = False,
            field_errors: dict[Literal["name", "email", "company", "message"], str] | None = None,
        ) -> JSONResponse:
            _chat_log(
                "contact.request_completed",
                request_id=request_id,
                status_code=status,
                outcome=outcome,
                retryable=retryable,
            )
            body = ContactSubmissionResponse(
                outcome=outcome,  # type: ignore[arg-type]
                retryable=retryable,
                request_id=request_id,
                field_errors=field_errors,
            )
            return JSONResponse(status_code=status, content=body.model_dump(exclude_none=True))

        if not request.headers.get("content-type", "").lower().startswith("application/json"):
            return response(400, "validation_error")
        raw = await request.body()
        if len(raw) > MAX_CONTACT_BODY_BYTES:
            return response(400, "validation_error")
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return response(400, "validation_error")
        if (
            isinstance(payload, dict)
            and payload.get("submission_version") != CONTACT_SUBMISSION_VERSION
        ):
            return response(422, "unsupported_version")
        try:
            submission = ContactSubmission.model_validate(payload)
        except ValidationError as error:
            field_errors: dict[Literal["name", "email", "company", "message"], str] = {}
            for item in error.errors(include_input=False):
                if not item.get("loc"):
                    continue
                field = item["loc"][0]
                if field in {"name", "email", "company", "message"}:
                    field_errors[field] = str(item["type"])  # type: ignore[index]
            return response(400, "validation_error", field_errors=field_errors or None)
        key = request.headers.get("idempotency-key", "")
        try:
            parsed_key = uuid.UUID(key)
            if parsed_key.version != 4 or str(parsed_key) != key.lower():
                raise ValueError
        except (ValueError, AttributeError):
            return response(400, "validation_error")
        if not contact_enabled or contact_delivery is None or contact_guard is None:
            return response(503, "delivery_unavailable")
        fingerprint = hashlib.sha256(raw).hexdigest()
        if request.client is None or not request.client.host:
            return response(503, "delivery_unavailable")
        client_identity = request.client.host
        decision = contact_guard.reserve(client_identity, key, fingerprint)
        decision_map = {
            "duplicate_processing": (202, "duplicate_processing", True),
            "duplicate_accepted": (200, "duplicate_accepted", False),
            "delivery_uncertain": (503, "delivery_uncertain", False),
            "idempotency_conflict": (409, "idempotency_conflict", False),
            "throttled": (429, "throttled", True),
        }
        if decision != "reserved":
            status, outcome, retryable = decision_map[decision]
            return response(status, outcome, retryable)
        try:
            await run_in_threadpool(contact_delivery.deliver, submission)  # type: ignore[attr-defined]
        except ContactDeliveryFailure as error:
            if error.uncertain:
                contact_guard.mark_uncertain(key)
                return response(503, "delivery_uncertain")
            contact_guard.release(key)
            return response(
                502,
                "delivery_retryable" if error.retryable else "delivery_failed",
                error.retryable,
            )
        except Exception:
            contact_guard.release(key)
            return response(503, "delivery_unavailable")
        contact_guard.mark_accepted(key)
        return response(200, "accepted")

    return app


def _default_app(*, debug: bool = False) -> FastAPI:
    """Build production dependencies without making an OpenAI request at startup."""

    stage = "chat_admission"
    try:
        chat_admission = ChatAdmissionGuard.from_environment(os.environ)
        stage = "service_token"
        service_token = os.environ["CHAT_SERVICE_TOKEN"]
        stage = "openai_api_key"
        api_key = os.environ["OPENAI_API_KEY"]
        content_root = Path(__file__).resolve().parents[2] / "content" / "v1"
        stage = "content_bundle"
        compatibility_version = load_content_bundle(content_root).portfolio.content_version
        model = os.getenv("OPENAI_MODEL", "gpt-5-mini")
        stage = "budget_config"
        budget_config = BudgetConfig.from_environment(os.environ, model)
        limits = ProviderLimits(
            model=model,
            max_input_tokens=budget_config.max_input_tokens,
            max_output_tokens=budget_config.max_output_tokens,
            input_cost_per_million=float(budget_config.input_cost_per_million),
            output_cost_per_million=float(budget_config.output_cost_per_million),
        )
        stage = "provider"
        provider = OpenAIChatProvider(api_key=api_key, limits=limits)
        embedding_model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
        stage = "retriever"
        retriever = SupabasePdfRetriever(
            os.environ["SUPABASE_DB_URL"],
            OpenAIEmbedder(api_key, model=embedding_model),
            embedding_model=embedding_model,
        )
        stage = "budget_store"
        budget_store = PostgresChatBudgetStore(os.environ["SUPABASE_DB_URL"], budget_config)
    except (KeyError, OSError, ValueError, PdfRetrievalError) as error:
        if stage in _STARTUP_STAGES:
            logger.error(
                "startup_readiness_failed stage=%s error_type=%s",
                stage,
                type(error).__name__,
            )
        return create_app(ready=False, debug=debug)
    contact_enabled = os.getenv("CONTACT_FORM_ENABLED", "false").lower() == "true"
    contact_delivery: BrevoContactDelivery | None = None
    contact_guard: EphemeralSubmissionGuard | None = None
    if contact_enabled:
        try:
            contact_delivery = BrevoContactDelivery(
                os.environ["BREVO_API_KEY"],
                os.environ["BREVO_SENDER_EMAIL"],
                os.environ["BREVO_RECIPIENT_EMAIL"],
            )
            contact_guard = EphemeralSubmissionGuard(
                os.environ["CONTACT_HMAC_SECRET"],
                ttl_seconds=int(os.getenv("CONTACT_IDEMPOTENCY_TTL_SECONDS", "900")),
                rate_window_seconds=int(os.getenv("CONTACT_RATE_WINDOW_SECONDS", "600")),
                rate_limit=int(os.getenv("CONTACT_RATE_LIMIT", "5")),
                capacity=int(os.getenv("CONTACT_GUARD_CAPACITY", "2000")),
            )
        except (KeyError, ValueError):
            contact_delivery = None
            contact_guard = None
    return create_app(
        retriever=retriever,
        content_version=compatibility_version,
        provider=provider,
        provider_model=limits.model,
        allowed_origins=_configured_origins(os.getenv("CORS_ALLOWED_ORIGINS")),
        preview_origin_regex=_configured_preview_origin_regex(
            os.getenv("CORS_PREVIEW_ORIGIN_REGEX")
        ),
        debug=debug,
        contact_enabled=contact_enabled,
        contact_delivery=contact_delivery,
        contact_guard=contact_guard,
        chat_admission=chat_admission,
        service_token=service_token,
        budget_store=budget_store,
        budget_config=budget_config,
    )


app = _default_app()
