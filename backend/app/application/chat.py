"""Application-layer chat pipeline — candidate validation, hydration, and NDJSON event building."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel

from app.domain.content import ContentBundle, PortfolioRecord, ProjectLink

# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------


class CandidateValidationError(ValueError):
    """Raised when a provider candidate fails validation."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


# ---------------------------------------------------------------------------
# Part models — final hydrated output sent to frontend
# ---------------------------------------------------------------------------


class TextPart(BaseModel):
    type: Literal["text"] = "text"
    text: str
    record_ids: list[str]
    claim_ids: list[str]


class SourcePart(BaseModel):
    type: Literal["source"] = "source"
    record_id: str
    label: str


class ProjectCardPart(BaseModel):
    type: Literal["project-card"] = "project-card"
    record_id: str
    title: str
    summary: str
    links: list[ProjectLink]


# ---------------------------------------------------------------------------
# NDJSON event models
# ---------------------------------------------------------------------------


class StartEvent(BaseModel):
    request_id: str
    sequence: int
    type: Literal["start"] = "start"
    content_version: str


class PartEvent(BaseModel):
    request_id: str
    sequence: int
    type: Literal["part"] = "part"
    part: TextPart | SourcePart | ProjectCardPart


class RefusalEvent(BaseModel):
    request_id: str
    sequence: int
    type: Literal["refusal"] = "refusal"
    code: str
    message: str
    retryable: bool


class ErrorEvent(BaseModel):
    request_id: str
    sequence: int
    type: Literal["error"] = "error"
    code: str
    message: str
    retryable: bool


class DoneEvent(BaseModel):
    request_id: str
    sequence: int
    type: Literal["done"] = "done"
    content_version: str


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

_ALLOWED_TYPES: frozenset[str] = frozenset({"text", "source", "project-card"})
_HTML_TAG = re.compile(r"<[a-zA-Z][^>]*>")


def _has_html(data: Mapping[str, object]) -> bool:
    """Return True if any string value in the candidate dict contains an HTML tag."""
    for value in data.values():
        if isinstance(value, str) and _HTML_TAG.search(value):
            return True
        if isinstance(value, list):
            for item in value:
                if isinstance(item, str) and _HTML_TAG.search(item):
                    return True
    return False


def _build_record_lookup(
    bundle: ContentBundle,
) -> tuple[dict[str, PortfolioRecord], set[str]]:
    """Build a record-id→PortfolioRecord map and a set of all known claim_ids."""
    records_by_id: dict[str, PortfolioRecord] = {}
    all_claim_ids: set[str] = set()
    for record in bundle.portfolio.records:
        records_by_id[record.id] = record
        for claim in record.claims:
            all_claim_ids.add(claim.claim_id)
    return records_by_id, all_claim_ids


# ---------------------------------------------------------------------------
# Candidate validation
# ---------------------------------------------------------------------------


def validate_candidate(
    candidate: Mapping[str, object],
    bundle: ContentBundle,
) -> TextPart | SourcePart | ProjectCardPart:
    """Validate a raw provider candidate against the ContentBundle.

    Returns a validated hydrated part.
    Raises CandidateValidationError on any validation failure.
    """
    # Step 1: Check type is allowed
    part_type = candidate.get("type")
    if not isinstance(part_type, str) or part_type not in _ALLOWED_TYPES:
        raise CandidateValidationError(
            code="invalid-provider-output",
            message="No pude validar la respuesta.",
        )

    # Step 2: Check for HTML tags in any string field
    if _has_html(candidate):
        raise CandidateValidationError(
            code="invalid-provider-output",
            message="No pude validar la respuesta.",
        )

    # Build lookup structures
    records_by_id, all_claim_ids = _build_record_lookup(bundle)

    if part_type == "text":
        return _validate_text(candidate, records_by_id, all_claim_ids)
    elif part_type == "source":
        return _validate_source(candidate, records_by_id)
    elif part_type == "project-card":
        return _validate_project_card(candidate, records_by_id)
    else:
        # Unreachable due to the type check above, but keep mypy happy
        raise CandidateValidationError(
            code="invalid-provider-output",
            message="No pude validar la respuesta.",
        )


def _validate_text(
    candidate: Mapping[str, object],
    records_by_id: dict[str, PortfolioRecord],
    all_claim_ids: set[str],
) -> TextPart:
    """Validate and return a text part."""
    text = candidate.get("text")
    record_ids = candidate.get("record_ids")
    claim_ids = candidate.get("claim_ids")

    if (
        not isinstance(text, str)
        or not isinstance(record_ids, list)
        or not isinstance(claim_ids, list)
    ):
        raise CandidateValidationError(
            code="invalid-provider-output",
            message="No pude validar la respuesta.",
        )

    # Check referenced record_ids exist
    for rid in record_ids:
        if not isinstance(rid, str) or rid not in records_by_id:
            raise CandidateValidationError(
                code="invalid-provider-output",
                message="No pude validar la respuesta.",
            )

    # Check referenced claim_ids exist
    for cid in claim_ids:
        if not isinstance(cid, str) or cid not in all_claim_ids:
            raise CandidateValidationError(
                code="invalid-provider-output",
                message="No pude validar la respuesta.",
            )

    return TextPart(text=text, record_ids=list(record_ids), claim_ids=list(claim_ids))


def _validate_source(
    candidate: Mapping[str, object],
    records_by_id: dict[str, PortfolioRecord],
) -> SourcePart:
    """Validate and hydrate a source part."""
    record_id = candidate.get("record_id")
    if not isinstance(record_id, str) or record_id not in records_by_id:
        raise CandidateValidationError(
            code="invalid-provider-output",
            message="No pude validar la respuesta.",
        )
    record = records_by_id[record_id]
    # Hydrate label from the record's title
    return SourcePart(record_id=record_id, label=record.title)


def _validate_project_card(
    candidate: Mapping[str, object],
    records_by_id: dict[str, PortfolioRecord],
) -> ProjectCardPart:
    """Validate and hydrate a project-card part."""
    record_id = candidate.get("record_id")
    if not isinstance(record_id, str) or record_id not in records_by_id:
        raise CandidateValidationError(
            code="invalid-provider-output",
            message="No pude validar la respuesta.",
        )
    record = records_by_id[record_id]
    project = record.project
    if project is None:
        raise CandidateValidationError(
            code="invalid-provider-output",
            message="No pude validar la respuesta.",
        )
    # Hydrate title, summary, and links from the actual record
    links = list(project.links) if project.links is not None else []
    return ProjectCardPart(
        record_id=record_id,
        title=record.title,
        summary=project.summary,
        links=links,
    )


# ---------------------------------------------------------------------------
# Event stream builder
# ---------------------------------------------------------------------------

_DEFAULT_ERROR_MESSAGE = "No pude procesar la solicitud."


def build_event_stream(
    request_id: str,
    content_version: str,
    *,
    validated_parts: list[TextPart | SourcePart | ProjectCardPart] | None = None,
    refusal: dict[str, object] | None = None,
    error: dict[str, object] | None = None,
) -> list[dict[str, Any]]:
    """Build an ordered list of typed NDJSON event dicts.

    Order: start → [refusal | error | parts...] → done.
    Refusal or error take precedence over parts (mutually exclusive).
    """
    events: list[dict[str, object]] = []
    sequence = 0

    # Start
    sequence += 1
    events.append(
        StartEvent(
            request_id=request_id,
            sequence=sequence,
            content_version=content_version,
        ).model_dump(mode="json")
    )

    if refusal is not None:
        sequence += 1
        events.append(
            RefusalEvent(
                request_id=request_id,
                sequence=sequence,
                code=str(refusal.get("code", "")),
                message=str(refusal.get("message", _DEFAULT_ERROR_MESSAGE)),
                retryable=bool(refusal.get("retryable", False)),
            ).model_dump(mode="json")
        )
    elif error is not None:
        sequence += 1
        events.append(
            ErrorEvent(
                request_id=request_id,
                sequence=sequence,
                code=str(error.get("code", "")),
                message=str(error.get("message", _DEFAULT_ERROR_MESSAGE)),
                retryable=bool(error.get("retryable", False)),
            ).model_dump(mode="json")
        )
    elif validated_parts:
        for part in validated_parts:
            sequence += 1
            events.append(
                PartEvent(
                    request_id=request_id,
                    sequence=sequence,
                    part=part,
                ).model_dump(mode="json")
            )

    # Done
    sequence += 1
    events.append(
        DoneEvent(
            request_id=request_id,
            sequence=sequence,
            content_version=content_version,
        ).model_dump(mode="json")
    )

    return events
