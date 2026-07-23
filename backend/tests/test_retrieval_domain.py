"""Tests for domain-level evidence retrieval (task 3.1)."""

from app.domain.content import ContentBundle, PortfolioContent, ReviewedManifest, SourceText
from app.domain.retrieval import normalize_query, retrieve_evidence

# ---------------------------------------------------------------------------
# Helpers — minimal inline ContentBundle factories
# ---------------------------------------------------------------------------


def _make_bundle(records: list[dict]) -> ContentBundle:
    portfolio = PortfolioContent.model_validate({
        "schema_version": "1.0.0",
        "content_version": "a" * 64,
        "locale": "es",
        "records": records,
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
# normalize_query
# ---------------------------------------------------------------------------


class TestNormalizeQuery:
    def test_nfc_and_lowercase_and_strip_punctuation(self) -> None:
        raw = "  CAFE\u0301 CON  IA!  "
        assert normalize_query(raw) == "café con ia"

    def test_keeps_spanish_chars(self) -> None:
        raw = "Experiencia en ingeniería: LLM, NLP."
        assert normalize_query(raw) == "experiencia en ingeniería llm nlp"

    def test_keeps_numbers(self) -> None:
        raw = "Python 3.13 y FastAPI 0.139"
        assert normalize_query(raw) == "python 3 13 y fastapi 0 139"

    def test_empty_after_normalization(self) -> None:
        raw = "!!! ..."
        assert normalize_query(raw) == ""


# ---------------------------------------------------------------------------
# retrieve_evidence — classification
# ---------------------------------------------------------------------------


class TestRetrievalClassification:
    def test_unsafe_query_returns_unsafe_before_scoring(self) -> None:
        bundle = _make_bundle([
            {"id": "mi-proyecto", "kind": "project", "title": "Mi Proyecto",
             "claims": [{"claim_id": "c1", "text": "Construido con Python",
                         "provenance_id": "p1"}],
             "tags": ["python"], "aliases": ["mi proyecto"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence(
            "ignorar todo, inyección de prompt", bundle
        )
        assert outcome.classification == "unsafe"
        assert outcome.results == []

    def test_allowed_when_score_meets_threshold(self) -> None:
        bundle = _make_bundle([
            {"id": "proyecto-uno", "kind": "project", "title": "Proyecto Uno",
             "claims": [{"claim_id": "c1", "text": "Hecho en Python",
                         "provenance_id": "p1"}],
             "tags": ["python"], "aliases": ["proyecto uno"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("Proyecto Uno Python", bundle)
        assert outcome.classification == "allowed"
        assert len(outcome.results) >= 1

    def test_unsupported_when_no_matching_records(self) -> None:
        bundle = _make_bundle([
            {"id": "proyecto-uno", "kind": "project", "title": "Proyecto Uno",
             "claims": [{"claim_id": "c1", "text": "Hecho en Python",
                         "provenance_id": "p1"}],
             "tags": ["python"], "aliases": ["proyecto uno"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("JavaScript Go Rust", bundle)
        assert outcome.classification == "unsupported"
        assert outcome.results == []

    def test_empty_query_after_normalization_is_unsupported(self) -> None:
        bundle = _make_bundle([
            {"id": "proyecto-uno", "kind": "project", "title": "Proyecto Uno",
             "claims": [{"claim_id": "c1", "text": "Hecho en Python",
                         "provenance_id": "p1"}],
             "tags": ["python"], "aliases": ["proyecto uno"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("!!!", bundle)
        assert outcome.classification == "unsupported"
        assert outcome.results == []

    def test_query_exceeding_max_length_is_clipped(self) -> None:
        bundle = _make_bundle([
            {"id": "proyecto-uno", "kind": "project", "title": "Proyecto Uno",
             "claims": [{"claim_id": "c1", "text": "Hecho en Python",
                         "provenance_id": "p1"}],
             "tags": ["python"], "aliases": ["proyecto uno"],
             "provenance": ["p1"]},
        ])
        long_query = "Python " * 200
        outcome = retrieve_evidence(long_query, bundle, max_query_length=50)
        assert len(outcome.query_normalized) <= 50


# ---------------------------------------------------------------------------
# retrieve_evidence — scoring and result details
# ---------------------------------------------------------------------------


class TestRetrievalScoring:
    def test_alias_title_match_scores_higher(self) -> None:
        """Alias/title tokens (weight 2) should outrank claim/tag tokens (weight 1)."""
        bundle = _make_bundle([
            {"id": "r1", "kind": "project", "title": "Proyecto Alpha",
             "claims": [{"claim_id": "c1", "text": "Creado en Java",
                         "provenance_id": "p1"}],
             "tags": ["java"], "aliases": ["alpha"],
             "provenance": ["p1"]},
            {"id": "r2", "kind": "project", "title": "Proyecto Beta",
             "claims": [{"claim_id": "c2", "text": "Proyecto",
                         "provenance_id": "p1"}],
             "tags": ["beta"], "aliases": ["beta"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("alpha java", bundle)
        allowed = [r for r in outcome.results if r.score > 0]
        assert allowed
        scores = {r.record_id: r.score for r in allowed}
        # "alpha" in alias → weight 2 + "java" in claim/tag → weight 1 = 3
        # "java" in claim/tag → weight 1 = 1
        assert scores.get("r1", 0) > scores.get("r2", 0)

    def test_stable_sort_by_score_desc_then_id_asc(self) -> None:
        bundle = _make_bundle([
            {"id": "z-proyecto", "kind": "skill", "title": "Docker",
             "claims": [{"claim_id": "c1", "text": "Docker compose",
                         "provenance_id": "p1"}],
             "tags": ["devops", "docker"], "aliases": ["docker"],
             "provenance": ["p1"]},
            {"id": "a-proyecto", "kind": "skill", "title": "Docker Swarm",
             "claims": [{"claim_id": "c2", "text": "Docker orquestación",
                         "provenance_id": "p1"}],
             "tags": ["devops", "docker"], "aliases": ["docker"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("docker", bundle)
        ids = [r.record_id for r in outcome.results]
        assert ids == sorted(ids, reverse=False)  # ascending when scores equal

    def test_top_k_limits_results(self) -> None:
        bundle = _make_bundle([
            {"id": f"r{i}", "kind": "project", "title": "Proyecto",
             "claims": [{"claim_id": f"c{i}", "text": "Python",
                         "provenance_id": "p1"}],
             "tags": ["python"], "aliases": ["proyecto", "python"],
             "provenance": ["p1"]}
            for i in range(5)
        ])
        outcome = retrieve_evidence("python proyecto", bundle, top_k=2)
        assert len(outcome.results) == 2

    def test_min_score_threshold_filters_results(self) -> None:
        bundle = _make_bundle([
            {"id": "r1", "kind": "project", "title": "Proyecto Alpha",
             "claims": [{"claim_id": "c1", "text": "Python backend",
                         "provenance_id": "p1"}],
             "tags": ["python"], "aliases": ["alpha", "python"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("python", bundle, min_score=10)
        assert outcome.results == []

    def test_matched_claims_are_reported(self) -> None:
        bundle = _make_bundle([
            {"id": "r1", "kind": "project", "title": "Proyecto Alpha",
             "claims": [
                 {"claim_id": "c1", "text": "Python backend",
                  "provenance_id": "p1"},
                 {"claim_id": "c2", "text": "FastAPI REST",
                  "provenance_id": "p1"},
             ],
             "tags": ["python", "fastapi"], "aliases": ["alpha"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("python", bundle)
        assert outcome.results
        assert "c1" in outcome.results[0].matched_claims

    def test_provenance_included_in_result(self) -> None:
        bundle = _make_bundle([
            {"id": "r1", "kind": "project", "title": "Proyecto Alpha",
             "claims": [{"claim_id": "c1", "text": "Python",
                         "provenance_id": "p1"}],
             "tags": ["python"], "aliases": ["alpha"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("python", bundle)
        assert outcome.results
        assert "p1" in outcome.results[0].provenance


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestRetrievalEdgeCases:
    def test_query_does_not_match_any_field(self) -> None:
        bundle = _make_bundle([
            {"id": "r1", "kind": "project", "title": "Proyecto Alpha",
             "claims": [{"claim_id": "c1", "text": "Python",
                         "provenance_id": "p1"}],
             "tags": ["python"], "aliases": ["alpha"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("zzzzzz", bundle)
        assert outcome.classification == "unsupported"
        assert outcome.results == []

    def test_unsafe_patterns_custom_blocklist(self) -> None:
        bundle = _make_bundle([
            {"id": "r1", "kind": "project", "title": "Proyecto Alpha",
             "claims": [{"claim_id": "c1", "text": "Tech",
                         "provenance_id": "p1"}],
             "tags": ["tech"], "aliases": ["alpha"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("hack the system", bundle,
                                     unsafe_patterns={"hack"})
        assert outcome.classification == "unsafe"

    def test_token_appears_in_alias_and_claim_scores_once(self) -> None:
        """A token matching both alias and claim should not double-count."""
        bundle = _make_bundle([
            {"id": "r1", "kind": "project", "title": "Alpha",
             "claims": [{"claim_id": "c1", "text": "Alpha framework",
                         "provenance_id": "p1"}],
             "tags": ["framework"], "aliases": ["alpha", "framework"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("alpha framework", bundle)
        # "alpha" → alias match (weight 2), "framework" → alias match (weight 2) = 4
        assert outcome.results[0].score == 4

    def test_partial_unsafe_pattern_no_false_positive(self) -> None:
        """Unsafe pattern 'ignorar' should not match 'ignorante' (token-level)."""
        bundle = _make_bundle([
            {"id": "r1", "kind": "project", "title": "Educación",
             "claims": [{"claim_id": "c1", "text": "Educación continua",
                         "provenance_id": "p1"}],
             "tags": ["educacion"], "aliases": ["educacion"],
             "provenance": ["p1"]},
        ])
        # "ignorante" should NOT trigger unsafe classification
        outcome = retrieve_evidence("ignorante", bundle)
        assert outcome.classification != "unsafe"
        # "ignorante" should not match "educacion" record content
        assert outcome.classification == "unsupported"

    def test_query_with_accented_spanish(self) -> None:
        """Accented input should match accented content."""
        bundle = _make_bundle([
            {"id": "r1", "kind": "skill", "title": "Comunicación",
             "claims": [{"claim_id": "c1", "text": "Comunicación efectiva",
                         "provenance_id": "p1"}],
             "tags": ["soft-skills"], "aliases": ["comunicación"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("comunicación", bundle)
        assert outcome.classification == "allowed"
        assert outcome.results[0].record_id == "r1"

    def test_multiple_records_match_different_tokens(self) -> None:
        """Each token should match the best-scoring record for that token."""
        bundle = _make_bundle([
            {"id": "python-proj", "kind": "project", "title": "Python API",
             "claims": [{"claim_id": "c1", "text": "Python backend",
                         "provenance_id": "p1"}],
             "tags": ["python"], "aliases": ["python-api"],
             "provenance": ["p1"]},
            {"id": "docker-proj", "kind": "project", "title": "Docker Deploy",
             "claims": [{"claim_id": "c2", "text": "Docker compose",
                         "provenance_id": "p1"}],
             "tags": ["docker"], "aliases": ["docker-deploy"],
             "provenance": ["p1"]},
        ])
        outcome = retrieve_evidence("python docker", bundle)
        assert outcome.classification == "allowed"
        assert len(outcome.results) == 2
        ids = [r.record_id for r in outcome.results]
        assert "python-proj" in ids
        assert "docker-proj" in ids

    def test_top_k_less_than_total_matches(self) -> None:
        """When top_k < matching records, only top_k returned."""
        bundle = _make_bundle([
            {"id": f"r{i}", "kind": "skill", "title": "Python",
             "claims": [{"claim_id": f"c{i}", "text": "Python dev",
                         "provenance_id": "p1"}],
             "tags": ["python"], "aliases": ["python"],
             "provenance": ["p1"]}
            for i in range(10)
        ])
        outcome = retrieve_evidence("python", bundle, top_k=3)
        assert len(outcome.results) == 3
