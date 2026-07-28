"""FastAPI transport boundary for the grounded portfolio chat."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app.application.chat import CandidateValidationError, build_event_stream, validate_candidate
from app.domain.content import ContentBundle, load_content_bundle
from app.domain.retrieval import retrieve_evidence
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


class ChatRequest(BaseModel):
    """Public, Spanish-only request contract."""

    model_config = ConfigDict(extra="forbid", strict=True)

    message: str = Field(min_length=1, max_length=500)
    locale: Literal["es"]
    client_request_id: str = Field(min_length=1, max_length=128)


def _ndjson(events: list[dict[str, object]]) -> Iterator[bytes]:
    for event in events:
        yield (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


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


def _validate_retrieval_references(
    candidate: Mapping[str, object],
    retrieved_record_ids: set[str],
    retrieved_claim_ids: set[str],
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
    record_id = candidate.get("record_id")
    if record_id is not None and (
        not isinstance(record_id, str) or record_id not in retrieved_record_ids
    ):
        raise CandidateValidationError("invalid-provider-output", "No pude validar la respuesta.")
    return candidate


def create_app(
    *,
    bundle: ContentBundle | None = None,
    provider: ChatProvider | None = None,
    provider_model: str = "fake",
    app_version: str = APP_VERSION,
    allowed_origins: tuple[str, ...] = DEFAULT_ORIGINS,
    preview_origin_regex: str = DEFAULT_PREVIEW_ORIGIN_REGEX,
    ready: bool | None = None,
) -> FastAPI:
    """Create an injectable app; unavailable dependencies surface only via readiness."""

    is_ready = ready if ready is not None else bundle is not None and provider is not None
    app = FastAPI(title="Portfolio API", version=app_version)
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

    @app.get("/metadata", tags=["system"])
    async def metadata():  # type: ignore[no-untyped-def]
        if not is_ready or bundle is None or provider is None:
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        return {
            "app_version": app_version,
            "content_version": bundle.portfolio.content_version,
            "model": provider_model,
        }

    @app.post("/api/v1/chat/stream", tags=["chat"])
    async def stream_chat(request: ChatRequest):  # type: ignore[no-untyped-def]
        if not is_ready or bundle is None or provider is None:
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        outcome = retrieve_evidence(request.message, bundle)
        if outcome.classification != "allowed":
            events = build_event_stream(
                request.client_request_id,
                bundle.portfolio.content_version,
                refusal=_refusal(outcome.classification),
            )
            return StreamingResponse(_ndjson(events), media_type="application/x-ndjson")

        retrieval_candidates = [
            {"record_id": item.record_id, "claim_ids": item.matched_claims}
            for item in outcome.results
        ]
        retrieved_record_ids = {result.record_id for result in outcome.results}
        retrieved_claim_ids = {
            claim_id for result in outcome.results for claim_id in result.matched_claims
        }
        records_by_id = {record.id: record for record in bundle.portfolio.records}
        public_evidence = {
            "records": [
                {
                    "id": result.record_id,
                    "title": records_by_id[result.record_id].title,
                    "claims": [
                        {"claim_id": claim.claim_id, "text": claim.text}
                        for claim in records_by_id[result.record_id].claims
                        if claim.claim_id in result.matched_claims
                    ],
                }
                for result in outcome.results
            ]
        }
        try:
            candidates = await run_in_threadpool(
                provider.generate,
                retrieval_candidates,
                public_evidence,
            )
            parts = [
                validate_candidate(
                    _validate_retrieval_references(
                        candidate, retrieved_record_ids, retrieved_claim_ids
                    ),
                    bundle,
                )
                for candidate in candidates
            ]
            events = build_event_stream(
                request.client_request_id,
                bundle.portfolio.content_version,
                validated_parts=parts,
            )
        except CandidateValidationError as error:
            events = build_event_stream(
                request.client_request_id,
                bundle.portfolio.content_version,
                error={"code": error.code, "message": error.message, "retryable": False},
            )
        except ProviderFailure as error:
            events = build_event_stream(
                request.client_request_id,
                bundle.portfolio.content_version,
                error=_provider_error(error),
            )
        return StreamingResponse(_ndjson(events), media_type="application/x-ndjson")

    return app


def _default_app() -> FastAPI:
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
        return create_app(ready=False)
    return create_app(bundle=bundle, provider=provider, provider_model=limits.model)


app = _default_app()
