"""FastAPI transport boundary for the grounded portfolio chat."""

from __future__ import annotations

import asyncio
import json
import logging
import os
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

        logger.info(
            "chat_request_started request_id=%s message_length=%d locale=%s",
            request_id,
            len(request.message),
            request.locale,
        )
        if not is_ready or retriever is None or provider is None:
            logger.warning("chat_request_unavailable request_id=%s", request_id)
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

            def on_text_delta(delta: str) -> None:
                if delta:
                    asyncio.run_coroutine_threadsafe(
                        progress.put(("text-delta", delta)), loop
                    ).result()

            def on_portfolio_search() -> None:
                progress.put_nowait(("tool", None))

            state["on_text_delta"] = on_text_delta
            state["on_portfolio_search"] = on_portfolio_search
            graph_task = asyncio.create_task(run_chat_graph(state))
            sequence = 1
            tool_event_emitted = False
            yield _sse(
                [
                    {
                        "request_id": request_id,
                        "sequence": sequence,
                        "type": "start",
                        "protocol_version": CHAT_PROTOCOL_VERSION,
                        "content_version": compatibility_version,
                    }
                ]
            ).__next__()
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
                    yield _sse([payload]).__next__()

                while not progress.empty():
                    sequence += 1
                    event_type, delta = progress.get_nowait()
                    payload = {"request_id": request_id, "sequence": sequence, "type": event_type}
                    if event_type == "text-delta":
                        payload["text"] = delta or ""
                    else:
                        payload["tool"] = "search_portfolio"
                        tool_event_emitted = True
                    yield _sse([payload]).__next__()

                async def finalize_events() -> list[dict[str, object]]:
                    result = await graph_task
                    portfolio_search_used = result.get("portfolio_search_used", False)
                    usage = result.get("usage", {"total_tokens": 0})
                    error = result.get("error")
                    completion = result.get("completion")
                    retrieval_results = result.get("retrieval_results")
                    if retrieval_results is not None:
                        logger.info(
                            "chat_tool_retrieval_completed request_id=%s "
                            "classification=%s result_count=%d",
                            request_id,
                            "available",
                            len(retrieval_results),
                        )
                        if app.debug:
                            logger.info(
                                "chat_debug_retrieval_outcome request_id=%s query=%r "
                                "classification=%s "
                                "result_count=%d record_ids=%s",
                                request_id,
                                result.get("retrieval_query", ""),
                                "available",
                                len(retrieval_results),
                                [item.chunk.id for item in retrieval_results],
                            )
                    if completion is not None and error is None and not result.get("refusal"):
                        logger.info(
                            "chat_provider_completed request_id=%s model=%s "
                            "candidate_count=%d total_tokens=%d",
                            request_id,
                            provider_model,
                            len(completion),
                            usage["total_tokens"],
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
                        if app.debug:
                            logger.warning(
                                "chat_debug_provider_output_rejected request_id=%s "
                                "validation_category=%s validation_code=%s candidate=%s",
                                request_id,
                                result.get("validation_category", "candidate-contract"),
                                error.code,
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
                            compatibility_version,
                            error={
                                "code": error.code,
                                "message": error.message,
                                "retryable": False,
                            },
                            portfolio_search_used=portfolio_search_used,
                            model=provider_model,
                            usage=usage,
                        )
                    elif isinstance(error, ProviderFailure):
                        if app.debug and portfolio_search_used:
                            logger.warning(
                                "chat_debug_provider_output_rejected request_id=%s "
                                "validation_category=provider-contract "
                                "validation_code=%s parser_stage=%s "
                                "response_metadata=%s",
                                request_id,
                                error.code,
                                error.diagnostic_category or "none",
                                json.dumps(
                                    error.diagnostic_metadata, separators=(",", ":"), sort_keys=True
                                ),
                            )
                        if (
                            error.diagnostic_category is None
                            or error.code == "invalid-provider-output"
                        ):
                            logger.warning(
                                "chat_provider_failed request_id=%s code=%s", request_id, error.code
                            )
                        else:
                            logger.warning(
                                "chat_provider_failed request_id=%s code=%s diagnostic_category=%s",
                                request_id,
                                error.code,
                                error.diagnostic_category,
                            )
                        events = build_event_stream(
                            request_id,
                            compatibility_version,
                            error=_provider_error(error),
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
                    terminal_state = next(
                        (
                            event["type"]
                            for event in reversed(events)
                            if event["type"] in {"error", "refusal"}
                        ),
                        "done",
                    )
                    logger.info(
                        "chat_stream_completed request_id=%s terminal_state=%s event_count=%d",
                        request_id,
                        terminal_state,
                        len(events),
                    )
                    return events

                for event in (await finalize_events())[1:]:
                    if event["type"] == "tool" and tool_event_emitted:
                        continue
                    sequence += 1
                    event["sequence"] = sequence
                    yield _sse([event]).__next__()
            finally:
                if not graph_task.done():
                    graph_task.cancel()
                    await asyncio.gather(graph_task, return_exceptions=True)

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
