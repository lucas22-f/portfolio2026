"""Public chat event contract: text plus server-owned PDF citations."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Literal, cast

from pydantic import BaseModel

from app.application.contact import InterviewContactFormPart
from app.infrastructure.pdf_rag import PdfCitation

CHAT_PROTOCOL_VERSION: Literal["5"] = "5"


class CandidateValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code, self.message = code, message
        super().__init__(message)


class TextPart(BaseModel):
    type: Literal["text"] = "text"
    text: str
    grounding: Literal["general", "portfolio"] = "portfolio"


class SourcePart(BaseModel):
    type: Literal["source"] = "source"
    filename: str
    page: int


ValidatedPart = TextPart | SourcePart | InterviewContactFormPart
_HTML_TAG = re.compile(r"<[a-zA-Z][^>]*>")


def validate_candidate(candidate: Mapping[str, object]) -> TextPart:
    """Accept only a text candidate; citations are never provider-controlled."""
    if set(candidate) != {"type", "text", "grounding"}:
        raise CandidateValidationError("invalid-provider-output", "No pude validar la respuesta.")
    text, grounding = candidate.get("text"), candidate.get("grounding")
    if (
        candidate.get("type") != "text"
        or not isinstance(text, str)
        or not text.strip()
        or _HTML_TAG.search(text)
    ):
        raise CandidateValidationError("invalid-provider-output", "No pude validar la respuesta.")
    if grounding not in {"general", "portfolio"}:
        raise CandidateValidationError("invalid-provider-output", "No pude validar la respuesta.")
    return TextPart(text=text, grounding=cast(Literal["general", "portfolio"], grounding))


def citations_to_parts(citations: list[PdfCitation]) -> list[SourcePart]:
    seen: set[tuple[str, int]] = set()
    parts: list[SourcePart] = []
    for citation in citations:
        key = (citation.filename, citation.page)
        if key not in seen:
            seen.add(key)
            parts.append(SourcePart(filename=citation.filename, page=citation.page))
    return parts


def build_event_stream(
    request_id: str,
    content_version: str,
    *,
    validated_parts: list[ValidatedPart] | None = None,
    refusal: dict[str, object] | None = None,
    error: dict[str, object] | None = None,
    portfolio_search_used: bool = False,
    model: str = "fake",
    usage: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = [
        {
            "request_id": request_id,
            "sequence": 1,
            "type": "start",
            "protocol_version": CHAT_PROTOCOL_VERSION,
            "content_version": content_version,
        }
    ]
    if portfolio_search_used:
        events.append(
            {
                "request_id": request_id,
                "sequence": len(events) + 1,
                "type": "tool",
                "tool": "search_portfolio",
            }
        )
    if refusal is not None or error is not None:
        payload = refusal if refusal is not None else error
        assert payload is not None
        events.append(
            {
                "request_id": request_id,
                "sequence": len(events) + 1,
                "type": "refusal" if refusal else "error",
                "code": str(payload.get("code", "")),
                "message": str(payload.get("message", "No pude procesar la solicitud.")),
                "retryable": bool(payload.get("retryable", False)),
            }
        )
    else:
        for part in validated_parts or []:
            events.append(
                {
                    "request_id": request_id,
                    "sequence": len(events) + 1,
                    "type": "part",
                    "part": part.model_dump(mode="json"),
                }
            )
    events.append(
        {
            "request_id": request_id,
            "sequence": len(events) + 1,
            "type": "done",
            "protocol_version": CHAT_PROTOCOL_VERSION,
            "content_version": content_version,
            "model": model,
            "usage": usage or {"total_tokens": 0},
        }
    )
    return events
