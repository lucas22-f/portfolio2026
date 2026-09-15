"""FastAPI transport boundary for the grounded portfolio chat."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app.application.chat import (
    CHAT_PROTOCOL_VERSION,
    CandidateValidationError,
    build_event_stream,
    validate_candidate,
)
from app.application.chat_graph import ChatGraphState, run_chat_graph
from app.domain.content import ContentBundle, load_content_bundle
from app.domain.retrieval import RetrievalOutcome, retrieve_evidence
from app.infrastructure.chat_provider import (
    ChatProvider,
    OpenAIChatProvider,
    ProviderFailure,
    ProviderLimits,
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


def _validate_retrieval_references(
    candidate: Mapping[str, object],
    retrieved_record_ids: set[str],
    retrieved_claim_ids: set[str],
    retrieved_claims_by_record: Mapping[str, set[str]],
) -> Mapping[str, object]:
    """Reject provider output that cites records or claims absent from retrieval."""

    record_ids = candidate.get("record_ids")
    if isinstance(record_ids, list) and not all(
        isinstance(record_id, str) and record_id in retrieved_record_ids for record_id in record_ids
    ):
        raise CandidateValidationError("invalid-provider-output", "No pude validar la respuesta.")
    claim_ids = candidate.get("claim_ids")
    if isinstance(claim_ids, list) and not all(
        isinstance(claim_id, str) and claim_id in retrieved_claim_ids for claim_id in claim_ids
    ):
        raise CandidateValidationError("invalid-provider-output", "No pude validar la respuesta.")
    if (
        isinstance(record_ids, list)
        and isinstance(claim_ids, list)
        and not all(
            any(
                isinstance(record_id, str)
                and claim_id in retrieved_claims_by_record.get(record_id, set())
                for record_id in record_ids
            )
            for claim_id in claim_ids
        )
    ):
        raise CandidateValidationError("invalid-provider-output", "No pude validar la respuesta.")
    record_id = candidate.get("record_id")
    if record_id is not None and (
        not isinstance(record_id, str) or record_id not in retrieved_record_ids
    ):
        raise CandidateValidationError("invalid-provider-output", "No pude validar la respuesta.")
    return candidate


def _build_public_evidence(
    bundle: ContentBundle, outcome: RetrievalOutcome
) -> tuple[dict[str, object], set[str], set[str], dict[str, set[str]]]:
    """Expose only retrieved records that retain at least one exact matched claim."""

    records_by_id = {record.id: record for record in bundle.portfolio.records}
    public_records: list[dict[str, object]] = []
    retrieved_record_ids: set[str] = set()
    retrieved_claim_ids: set[str] = set()
    retrieved_claims_by_record: dict[str, set[str]] = {}

    for result in outcome.results:
        record = records_by_id.get(result.record_id)
        if record is None:
            continue
        claims_by_id = {claim.claim_id: claim for claim in record.claims}
        matched_claims = [
            claims_by_id[claim_id]
            for claim_id in result.matched_claims
            if claim_id in claims_by_id
        ]
        if not matched_claims:
            continue
        matched_claim_ids = {claim.claim_id for claim in matched_claims}
        public_records.append(
            {
                "id": record.id,
                "title": record.title,
                "claims": [
                    {"claim_id": claim.claim_id, "text": claim.text} for claim in matched_claims
                ],
            }
        )
        retrieved_record_ids.add(record.id)
        retrieved_claim_ids.update(matched_claim_ids)
        retrieved_claims_by_record[record.id] = matched_claim_ids

    return (
        {"records": public_records},
        retrieved_record_ids,
        retrieved_claim_ids,
        retrieved_claims_by_record,
    )


def create_app(
    *,
    bundle: ContentBundle | None = None,
    provider: ChatProvider | None = None,
    provider_model: str = "fake",
    app_version: str = APP_VERSION,
    allowed_origins: tuple[str, ...] = DEFAULT_ORIGINS,
    preview_origin_regex: str = DEFAULT_PREVIEW_ORIGIN_REGEX,
    ready: bool | None = None,
    debug: bool = False,
) -> FastAPI:
    """Create an injectable app; unavailable dependencies surface only via readiness."""

    is_ready = ready if ready is not None else bundle is not None and provider is not None
    app = FastAPI(title="Portfolio API", version=app_version, debug=debug)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allowed_origins),
        allow_origin_regex=preview_origin_regex,
        allow_credentials=False,
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.get("/health", tags=["system"])
    async def health():  # type: ignore[no-untyped-def]
        if not is_ready or bundle is None or provider is None:
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        return {
            "status": "ok",
            "app_version": app_version,
            "content_version": bundle.portfolio.content_version,
        }

    @app.get("/api/v1/metadata", tags=["system"])
    @app.get("/metadata", tags=["system"], include_in_schema=False)
    async def metadata():  # type: ignore[no-untyped-def]
        if not is_ready or bundle is None or provider is None:
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        return {
            "app_version": app_version,
            "content_version": bundle.portfolio.content_version,
            "model": provider_model,
            "protocol_version": CHAT_PROTOCOL_VERSION,
        }

    @app.post("/api/v1/chat/stream", tags=["chat"])
    async def stream_chat(request: ChatRequest):  # type: ignore[no-untyped-def]
        request_id = request.client_request_id

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

        logger.info(
            "chat_request_started request_id=%s message_length=%d locale=%s",
            request_id,
            len(request.message),
            request.locale,
        )
        if not is_ready or bundle is None or provider is None:
            logger.warning("chat_request_unavailable request_id=%s", request_id)
            return JSONResponse(status_code=503, content={"status": "unavailable"})

        async def invoke_model(*args: object):  # type: ignore[no-untyped-def]
            return await run_in_threadpool(provider.generate, *args)

        state: ChatGraphState = {
            "message": request.message,
            "bundle": bundle,
            "invoke_model": invoke_model,
            "retrieve_evidence": retrieve_evidence,
            "validate_references": _validate_retrieval_references,
            "build_evidence": _build_public_evidence,
            "validate_candidate": validate_candidate,
        }
        result = await run_chat_graph(state)
        portfolio_search_used = result.get("portfolio_search_used", False)
        usage = result.get("usage", {"total_tokens": 0})
        error = result.get("error")
        completion = result.get("completion")
        retrieval_outcome = result.get("retrieval_outcome")
        if retrieval_outcome is not None:
            logger.info(
                "chat_tool_retrieval_completed request_id=%s classification=%s result_count=%d",
                request_id,
                retrieval_outcome.classification,
                len(retrieval_outcome.results),
            )
            if app.debug:
                logger.info(
                    "chat_debug_retrieval_outcome request_id=%s query=%r classification=%s "
                    "result_count=%d record_ids=%s",
                    request_id,
                    result.get("retrieval_query", ""),
                    retrieval_outcome.classification,
                    len(retrieval_outcome.results),
                    [item.record_id for item in retrieval_outcome.results],
                )
        if completion is not None and error is None and not result.get("refusal"):
            logger.info(
                "chat_provider_completed request_id=%s model=%s candidate_count=%d total_tokens=%d",
                request_id,
                provider_model,
                len(completion),
                usage["total_tokens"],
            )
        if result.get("refusal"):
            events = build_event_stream(
                request_id,
                bundle.portfolio.content_version,
                refusal=_refusal("unsafe"),
                portfolio_search_used=portfolio_search_used,
                model=provider_model,
                usage=usage,
            )
        elif isinstance(error, CandidateValidationError):
            if app.debug:
                logger.warning(
                    "chat_debug_provider_output_rejected request_id=%s "
                    "validation_category=%s validation_code=%s allowed_record_ids=%s "
                    "allowed_claim_ids=%s candidate=%s",
                    request_id,
                    result.get("validation_category", "candidate-contract"),
                    error.code,
                    sorted(result.get("record_ids", set())),
                    sorted(result.get("claim_ids", set())),
                    json.dumps(
                        result.get("invalid_candidate", {}),
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                )
            logger.warning(
                "chat_provider_output_rejected request_id=%s code=%s",
                request_id,
                error.code,
            )
            events = build_event_stream(
                request_id,
                bundle.portfolio.content_version,
                error={"code": error.code, "message": error.message, "retryable": False},
                portfolio_search_used=portfolio_search_used,
                model=provider_model,
                usage=usage,
            )
        elif isinstance(error, ProviderFailure):
            if app.debug and portfolio_search_used:
                logger.warning(
                    "chat_debug_provider_output_rejected request_id=%s "
                    "validation_category=provider-contract validation_code=%s parser_stage=%s "
                    "response_metadata=%s",
                    request_id,
                    error.code,
                    error.diagnostic_category or "none",
                    json.dumps(error.diagnostic_metadata, separators=(",", ":"), sort_keys=True),
                )
            if error.diagnostic_category is None or error.code == "invalid-provider-output":
                logger.warning("chat_provider_failed request_id=%s code=%s", request_id, error.code)
            else:
                logger.warning(
                    "chat_provider_failed request_id=%s code=%s diagnostic_category=%s",
                    request_id,
                    error.code,
                    error.diagnostic_category,
                )
            events = build_event_stream(
                request_id,
                bundle.portfolio.content_version,
                error=_provider_error(error),
                portfolio_search_used=portfolio_search_used,
                model=provider_model,
                usage=usage,
            )
        else:
            events = build_event_stream(
                request_id,
                bundle.portfolio.content_version,
                validated_parts=result.get("parts", []),
                portfolio_search_used=portfolio_search_used,
                model=provider_model,
                usage=usage,
            )
        terminal_state = next(
            (event["type"] for event in reversed(events) if event["type"] in {"error", "refusal"}),
            "done",
        )
        logger.info(
            "chat_stream_completed request_id=%s terminal_state=%s event_count=%d",
            request_id,
            terminal_state,
            len(events),
        )
        return stream_response(events)
    return app


def _default_app(*, debug: bool = False) -> FastAPI:
    """Build production dependencies without making an OpenAI request at startup."""

    try:
        content_root = Path(__file__).resolve().parents[2] / "content" / "v1"
        bundle = load_content_bundle(content_root)
        limits = ProviderLimits(model=os.getenv("OPENAI_MODEL", "gpt-5-mini"))
        provider = OpenAIChatProvider(
            api_key=os.environ["OPENAI_API_KEY"],
            limits=limits,
        )
    except (KeyError, OSError, ValueError):
        return create_app(ready=False, debug=debug)
    return create_app(
        bundle=bundle,
        provider=provider,
        provider_model=limits.model,
        allowed_origins=_configured_origins(os.getenv("CORS_ALLOWED_ORIGINS")),
        preview_origin_regex=_configured_preview_origin_regex(
            os.getenv("CORS_PREVIEW_ORIGIN_REGEX")
        ),
        debug=debug,
    )


app = _default_app()
