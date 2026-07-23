"""Tests for the application-layer chat pipeline (task 3.2)."""

import pytest

from app.application.chat import (
    CandidateValidationError,
    ProjectCardPart,
    SourcePart,
    TextPart,
    build_event_stream,
    validate_candidate,
)
from app.domain.content import (
    ContentBundle,
    PortfolioContent,
    ReviewedManifest,
    SourceText,
)

# ---------------------------------------------------------------------------
# Helpers — minimal inline ContentBundle factories
# ---------------------------------------------------------------------------


def _make_bundle(
    *,
    project_record_id: str = "python-proj",
    skill_record_id: str = "docker-skill",
) -> ContentBundle:
    """Create a minimal valid bundle with a project and a skill record."""
    portfolio = PortfolioContent.model_validate({
        "schema_version": "1.0.0",
        "content_version": "a" * 64,
        "locale": "es",
        "records": [
            {
                "id": project_record_id,
                "kind": "project",
                "title": "Python API REST",
                "claims": [
                    {"claim_id": "c1", "text": "Construido con FastAPI", "provenance_id": "p1"},
                    {"claim_id": "c2", "text": "Usa PostgreSQL", "provenance_id": "p1"},
                ],
                "tags": ["fastapi", "python", "backend"],
                "aliases": ["python-api", "api-rest"],
                "project": {
                    "summary": "API REST construida con FastAPI y PostgreSQL.",
                    "links": [
                        {"label": "GitHub", "url": "https://github.com/lucas22-f/python-api"},
                    ],
                },
                "provenance": ["p1"],
            },
            {
                "id": skill_record_id,
                "kind": "skill",
                "title": "Docker",
                "claims": [
                    {
                        "claim_id": "c3",
                        "text": "Experiencia en Docker compose",
                        "provenance_id": "p1",
                    },
                ],
                "tags": ["devops", "docker"],
                "aliases": ["docker"],
                "provenance": ["p1"],
            },
        ],
    })
    manifest = ReviewedManifest.model_validate({
        "schema_version": "1.0.0",
        "content_version": "a" * 64,
        "sources": [
            {"source_id": "cv", "file_name": "cv.pdf", "source_sha256": "b" * 64,
             "source_text_sha256": "c" * 64, "page_count": 1},
        ],
        "entries": [
            {"provenance_id": "p1", "source_id": "cv", "source_sha256": "b" * 64,
             "page": 1, "normalized_start": 0, "normalized_end": 10,
             "excerpt_sha256": "d" * 64, "reviewed_at": "2026-01-01", "reviewer": "test"},
        ],
    })
    source_text = SourceText.model_validate({
        "schema_version": "1.0.0",
        "normalization": "unicode-nfc-explicit-whitespace-utf8-offsets-v1",
        "source_id": "cv",
        "file_name": "cv.pdf",
        "source_sha256": "b" * 64,
        "pages": [{"page": 1, "normalized_text": "test", "normalized_sha256": "e" * 64}],
    })
    return ContentBundle(portfolio=portfolio, manifest=manifest, source_text=source_text)


# ---------------------------------------------------------------------------
# validate_candidate
# ---------------------------------------------------------------------------


class TestValidateCandidate:
    """Tests for candidate validation and hydration."""

    def test_valid_text_part(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "text",
            "text": "Lucas tiene experiencia en Python y FastAPI.",
            "record_ids": ["python-proj"],
            "claim_ids": ["c1"],
        }
        result = validate_candidate(candidate, bundle)
        assert isinstance(result, TextPart)
        assert result.type == "text"
        assert "Python" in result.text
        assert result.record_ids == ["python-proj"]
        assert result.claim_ids == ["c1"]

    def test_valid_source_part_hydrates_label_from_title(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "source",
            "record_id": "python-proj",
        }
        result = validate_candidate(candidate, bundle)
        assert isinstance(result, SourcePart)
        assert result.type == "source"
        assert result.record_id == "python-proj"
        assert result.label == "Python API REST"  # hydrated from record title

    def test_source_part_ignores_provider_label(self) -> None:
        """Provider-supplied label should be ignored; label comes from record title."""
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "source",
            "record_id": "python-proj",
            "label": "ignored-label",
        }
        result = validate_candidate(candidate, bundle)
        assert isinstance(result, SourcePart)
        assert result.label == "Python API REST"  # from record, not candidate

    def test_valid_project_card_part_hydrates_from_bundle(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "project-card",
            "record_id": "python-proj",
        }
        result = validate_candidate(candidate, bundle)
        assert isinstance(result, ProjectCardPart)
        assert result.type == "project-card"
        assert result.record_id == "python-proj"
        assert result.title == "Python API REST"
        assert result.summary == "API REST construida con FastAPI y PostgreSQL."
        assert len(result.links) == 1
        assert result.links[0].label == "GitHub"
        assert result.links[0].url == "https://github.com/lucas22-f/python-api"

    def test_project_card_ignores_provider_display_fields(self) -> None:
        """Provider-supplied title/summary should be ignored; hydrated from bundle."""
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "project-card",
            "record_id": "python-proj",
            "title": "falso-titulo",
            "summary": "falso-resumen",
            "links": [{"label": "X", "url": "https://x.com/fake"}],
        }
        result = validate_candidate(candidate, bundle)
        assert isinstance(result, ProjectCardPart)
        assert result.title == "Python API REST"
        assert result.summary == "API REST construida con FastAPI y PostgreSQL."
        assert result.links[0].label == "GitHub"

    def test_unknown_type_raises_error(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "unknown-type",
            "text": "whatever",
        }
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_missing_type_raises_error(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {"text": "no type here"}
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_html_in_text_raises_error(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "text",
            "text": "Hola <script>alert('xss')</script> mundo",
            "record_ids": [],
            "claim_ids": [],
        }
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_html_in_record_ids_raises_error(self) -> None:
        """HTML anywhere in any string field of the candidate should be rejected."""
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "text",
            "text": "texto limpio",
            "record_ids": ["<b>malicious</b>"],
            "claim_ids": [],
        }
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_unknown_record_id_raises_error(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "text",
            "text": "texto valido",
            "record_ids": ["non-existent-record"],
            "claim_ids": [],
        }
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_unknown_claim_id_raises_error(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "text",
            "text": "texto valido",
            "record_ids": ["python-proj"],
            "claim_ids": ["non-existent-claim"],
        }
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_source_part_unknown_record_raises_error(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "source",
            "record_id": "non-existent",
        }
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_project_card_on_non_project_record_raises_error(self) -> None:
        """A project-card referencing a record without project details should error."""
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "project-card",
            "record_id": "docker-skill",  # kind="skill", no project details
        }
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_project_card_unknown_record_raises_error(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "project-card",
            "record_id": "non-existent",
        }
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_missing_required_fields_raises_error(self) -> None:
        """A candidate without required fields should fail gracefully."""
        bundle = _make_bundle()
        candidate: dict[str, object] = {"type": "text"}  # missing text, record_ids, claim_ids
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_source_part_missing_record_id_raises_error(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {"type": "source"}  # missing record_id
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_project_card_missing_record_id_raises_error(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {"type": "project-card"}  # missing record_id
        with pytest.raises(CandidateValidationError) as exc:
            validate_candidate(candidate, bundle)
        assert exc.value.code == "invalid-provider-output"

    def test_text_part_with_no_record_ids_and_no_claim_ids(self) -> None:
        """A text part may have empty record_ids/claim_ids — it's still valid."""
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "text",
            "text": "Texto general sin referencias.",
            "record_ids": [],
            "claim_ids": [],
        }
        result = validate_candidate(candidate, bundle)
        assert isinstance(result, TextPart)
        assert result.record_ids == []
        assert result.claim_ids == []

    def test_self_closing_html_tag_raises_error(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "text",
            "text": "Linea con <br/> tag.",
            "record_ids": [],
            "claim_ids": [],
        }
        with pytest.raises(CandidateValidationError):
            validate_candidate(candidate, bundle)

    def test_mixed_valid_and_invalid_record_ids(self) -> None:
        """Partially valid references should still be rejected."""
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "text",
            "text": "texto valido",
            "record_ids": ["python-proj", "non-existent"],
            "claim_ids": [],
        }
        with pytest.raises(CandidateValidationError):
            validate_candidate(candidate, bundle)

    def test_mixed_valid_and_invalid_claim_ids(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "text",
            "text": "texto valido",
            "record_ids": ["python-proj"],
            "claim_ids": ["c1", "non-existent"],
        }
        with pytest.raises(CandidateValidationError):
            validate_candidate(candidate, bundle)

    def test_html_in_source_record_id_field(self) -> None:
        """HTML in any candidate field — including source record_id — is rejected."""
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "source",
            "record_id": "<b>python-proj</b>",
        }
        with pytest.raises(CandidateValidationError):
            validate_candidate(candidate, bundle)

    def test_html_in_project_card_record_id(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "project-card",
            "record_id": "<script>python-proj</script>",
        }
        with pytest.raises(CandidateValidationError):
            validate_candidate(candidate, bundle)

    def test_empty_candidate_dict_is_rejected(self) -> None:
        bundle = _make_bundle()
        candidate: dict[str, object] = {}
        with pytest.raises(CandidateValidationError):
            validate_candidate(candidate, bundle)

    def test_text_with_html_in_claim_ids_list(self) -> None:
        """HTML in a list element like claim_ids should also be caught."""
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "text",
            "text": "limpio",
            "record_ids": [],
            "claim_ids": ["c1", "<a>link</a>"],
        }
        with pytest.raises(CandidateValidationError):
            validate_candidate(candidate, bundle)

    def test_validate_candidate_does_not_mutate_input(self) -> None:
        """The function should not modify the caller's dict."""
        bundle = _make_bundle()
        original = {
            "type": "text",
            "text": "Texto original.",
            "record_ids": [],
            "claim_ids": [],
        }
        candidate_copy = dict(original)
        validate_candidate(candidate_copy, bundle)
        assert candidate_copy == original

    def test_angle_bracket_without_tag_name_is_not_html(self) -> None:
        """Sequences like `<3` or `<=5` should NOT be treated as HTML."""
        bundle = _make_bundle()
        candidate: dict[str, object] = {
            "type": "text",
            "text": "Version <3 de la libreria.",
            "record_ids": [],
            "claim_ids": [],
        }
        result = validate_candidate(candidate, bundle)
        assert isinstance(result, TextPart)
        assert "<3" in result.text


# ---------------------------------------------------------------------------
# build_event_stream
# ---------------------------------------------------------------------------


class TestBuildEventStream:
    """Tests for NDJSON event stream construction."""

    def test_start_done_only_with_no_parts(self) -> None:
        events = build_event_stream(
            request_id="req-001",
            content_version="a" * 64,
        )
        assert len(events) == 2
        assert events[0]["type"] == "start"
        assert events[0]["request_id"] == "req-001"
        assert events[0]["sequence"] == 1
        assert events[0]["content_version"] == "a" * 64
        assert events[1]["type"] == "done"
        assert events[1]["request_id"] == "req-001"
        assert events[1]["sequence"] == 2
        assert events[1]["content_version"] == "a" * 64

    def test_single_text_part(self) -> None:
        bundle = _make_bundle()
        part = validate_candidate({
            "type": "text",
            "text": "Contenido valido.",
            "record_ids": [],
            "claim_ids": [],
        }, bundle)
        events = build_event_stream(
            request_id="req-002",
            content_version="a" * 64,
            validated_parts=[part],
        )
        assert len(events) == 3
        assert events[0]["type"] == "start"
        assert events[1]["type"] == "part"
        assert events[1]["part"]["type"] == "text"
        assert events[1]["part"]["text"] == "Contenido valido."
        assert events[2]["type"] == "done"
        assert events[1]["sequence"] == 2
        assert events[2]["sequence"] == 3

    def test_multiple_parts_in_order(self) -> None:
        bundle = _make_bundle()
        part1 = validate_candidate({
            "type": "text", "text": "Primero.", "record_ids": [], "claim_ids": [],
        }, bundle)
        part2 = validate_candidate({
            "type": "source", "record_id": "python-proj",
        }, bundle)
        events = build_event_stream(
            request_id="req-003",
            content_version="a" * 64,
            validated_parts=[part1, part2],
        )
        assert len(events) == 4
        assert events[0]["type"] == "start"
        assert events[1]["type"] == "part"
        assert events[1]["part"]["type"] == "text"
        assert events[1]["part"]["text"] == "Primero."
        assert events[2]["type"] == "part"
        assert events[2]["part"]["type"] == "source"
        assert events[2]["part"]["record_id"] == "python-proj"
        assert events[3]["type"] == "done"

    def test_sequences_are_contiguous(self) -> None:
        events = build_event_stream(
            request_id="req-004",
            content_version="a" * 64,
            validated_parts=[
                TextPart(text="A", record_ids=[], claim_ids=[]),
                TextPart(text="B", record_ids=[], claim_ids=[]),
                TextPart(text="C", record_ids=[], claim_ids=[]),
            ],
        )
        sequences = [e["sequence"] for e in events]
        assert sequences == [1, 2, 3, 4, 5]

    def test_with_refusal_before_done(self) -> None:
        events = build_event_stream(
            request_id="req-005",
            content_version="a" * 64,
            refusal={
                "code": "unsupported-request",
                "message": "No tengo información sobre eso.",
                "retryable": False,
            },
        )
        assert len(events) == 3
        assert events[0]["type"] == "start"
        assert events[1]["type"] == "refusal"
        assert events[1]["code"] == "unsupported-request"
        assert events[1]["message"] == "No tengo información sobre eso."
        assert events[1]["retryable"] is False
        assert events[2]["type"] == "done"

    def test_with_error_before_done(self) -> None:
        events = build_event_stream(
            request_id="req-006",
            content_version="a" * 64,
            error={
                "code": "limit-exceeded",
                "message": "La solicitud supera el límite permitido.",
                "retryable": False,
            },
        )
        assert len(events) == 3
        assert events[0]["type"] == "start"
        assert events[1]["type"] == "error"
        assert events[1]["code"] == "limit-exceeded"
        assert events[1]["retryable"] is False
        assert events[2]["type"] == "done"

    def test_refusal_and_parts_are_mutually_exclusive(self) -> None:
        """If refusal is provided, parts are ignored (refusal takes precedence)."""
        events = build_event_stream(
            request_id="req-007",
            content_version="a" * 64,
            validated_parts=[TextPart(text="A", record_ids=[], claim_ids=[])],
            refusal={
                "code": "unsafe-request",
                "message": "No puedo responder eso.",
                "retryable": False,
            },
        )
        assert len(events) == 3  # start, refusal, done — no parts
        assert events[1]["type"] == "refusal"

    def test_error_and_parts_are_mutually_exclusive(self) -> None:
        """If error is provided, parts are ignored (error takes precedence)."""
        events = build_event_stream(
            request_id="req-008",
            content_version="a" * 64,
            validated_parts=[TextPart(text="A", record_ids=[], claim_ids=[])],
            error={
                "code": "invalid-provider-output",
                "message": "No pude validar la respuesta.",
                "retryable": False,
            },
        )
        assert len(events) == 3  # start, error, done — no parts
        assert events[1]["type"] == "error"

    def test_project_card_part_in_stream(self) -> None:
        bundle = _make_bundle()
        part = validate_candidate({
            "type": "project-card",
            "record_id": "python-proj",
        }, bundle)
        events = build_event_stream(
            request_id="req-009",
            content_version="a" * 64,
            validated_parts=[part],
        )
        assert len(events) == 3
        part_event = events[1]
        assert part_event["type"] == "part"
        assert part_event["part"]["type"] == "project-card"
        assert part_event["part"]["title"] == "Python API REST"
        assert len(part_event["part"]["links"]) == 1

    def test_request_id_carries_through_all_events(self) -> None:
        events = build_event_stream(
            request_id="req-010",
            content_version="a" * 64,
            validated_parts=[TextPart(text="X", record_ids=[], claim_ids=[])],
        )
        for event in events:
            assert event["request_id"] == "req-010"

    def test_mixed_validated_parts_types_in_stream(self) -> None:
        bundle = _make_bundle()
        text_part = validate_candidate({
            "type": "text", "text": "Texto.", "record_ids": [], "claim_ids": [],
        }, bundle)
        source_part = validate_candidate({
            "type": "source", "record_id": "python-proj",
        }, bundle)
        card_part = validate_candidate({
            "type": "project-card", "record_id": "python-proj",
        }, bundle)
        events = build_event_stream(
            request_id="req-011",
            content_version="a" * 64,
            validated_parts=[text_part, source_part, card_part],
        )
        assert len(events) == 5  # start, 3 parts, done
        assert events[1]["part"]["type"] == "text"
        assert events[2]["part"]["type"] == "source"
        assert events[3]["part"]["type"] == "project-card"
