"""FastAPI transport boundary for the grounded portfolio chat."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
from collections.abc import AsyncGenerator, Callable, Iterator, Mapping
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
)
from app.application.chat_graph import ChatGraphState, run_chat_graph
from app.domain.content import load_content_bundle
from app.infrastructure.chat_provider import (
    ChatProvider,
    OpenAIChatProvider,
    ProviderFailure,
    ProviderLimits,
    ProviderResult,
    ToolCall,
)
from app.infrastructure.pdf_rag import ChromaPdfRetriever, OpenAIEmbedder, PdfRetriever

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
) -> FastAPI:
    """Create an injectable app; unavailable dependencies surface only via readiness."""

    is_ready = ready if ready is not None else retriever is not None and provider is not None
    # This is the reviewed static-portfolio compatibility version consumed by the frontend.
    # It deliberately differs from the PDF hash used only to decide whether Chroma must rebuild.
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
        allow_headers=["Content-Type"],
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
        return {
            "app_version": app_version,
            "content_version": compatibility_version,
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

        started_at = time.perf_counter()
        _chat_log(
            "chat.request_accepted",
            request_id=request_id,
            client_request_id=request.client_request_id,
            locale=request.locale,
        )
        if not is_ready or retriever is None or provider is None:
            _chat_log(
                "chat.request_completed",
                request_id=request_id,
                status_code=503,
                terminal_outcome="unavailable",
                elapsed_ms=round((time.perf_counter() - started_at) * 1000),
            )
            return JSONResponse(status_code=503, content={"status": "unavailable"})

        async def invoke_model(
            message: str,
            evidence: Mapping[str, object] | None = None,
            tool_call: ToolCall | None = None,
            prior_input_tokens: int = 0,
            prior_output_tokens: int = 0,
            on_text_delta: Callable[[str], None] | None = None,
        ) -> ProviderResult:
            if isinstance(provider, OpenAIChatProvider):
                return await run_in_threadpool(
                    provider.generate,
                    message,
                    evidence,
                    tool_call,
                    prior_input_tokens,
                    prior_output_tokens,
                    on_text_delta,
                )
            return await run_in_threadpool(
                provider.generate,
                message,
                evidence,
                tool_call,
                prior_input_tokens,
                prior_output_tokens,
            )

        state: ChatGraphState = {
            "message": request.message,
            "retriever": retriever,
            "invoke_model": invoke_model,
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
                    client_request_id=request.client_request_id,
                    event_type=payload["type"],
                    sequence=payload["sequence"],
                    status_code=200,
                )
                return next(_sse([payload]))

            state["on_text_delta"] = on_text_delta
            state["on_portfolio_search"] = on_portfolio_search
            _chat_log("chat.graph_started", request_id=request_id)
            graph_task = asyncio.create_task(run_chat_graph(state))
            sequence = 1
            tool_event_emitted = False
            terminal_outcome = "cancelled"
            yield emit(
                {
                    "request_id": request_id,
                    "sequence": sequence,
                    "type": "start",
                    "protocol_version": CHAT_PROTOCOL_VERSION,
                    "content_version": compatibility_version,
                }
            )
            try:
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
                if not graph_task.done():
                    graph_task.cancel()
                    await asyncio.gather(graph_task, return_exceptions=True)
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

    return app


def _default_app(*, debug: bool = False) -> FastAPI:
    """Build production dependencies without making an OpenAI request at startup."""

    try:
        api_key = os.environ["OPENAI_API_KEY"]
        content_root = Path(__file__).resolve().parents[2] / "content" / "v1"
        compatibility_version = load_content_bundle(content_root).portfolio.content_version
        limits = ProviderLimits(model=os.getenv("OPENAI_MODEL", "gpt-5-mini"))
        provider = OpenAIChatProvider(api_key=api_key, limits=limits)
        retriever = ChromaPdfRetriever(
            Path(
                os.getenv(
                    "PDF_RAG_PDF_PATH",
                    str(Path(__file__).resolve().parent / "docs" / "CV_Lucas_Figueroa_1.pdf"),
                )
            ),
            Path(os.getenv("PDF_RAG_PERSIST_DIRECTORY", "/data/chroma")),
            OpenAIEmbedder(
                api_key, model=os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
            ),
        )
    except (KeyError, OSError, ValueError):
        return create_app(ready=False, debug=debug)
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
    )


app = _default_app()
