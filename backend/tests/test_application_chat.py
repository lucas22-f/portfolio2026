import pytest

from app.application.chat import (
    CandidateValidationError,
    SourcePart,
    citations_to_parts,
    validate_candidate,
)
from app.infrastructure.pdf_rag import PdfCitation


def test_validates_portfolio_text_without_provider_owned_citations() -> None:
    part = validate_candidate(
        {"type": "text", "text": "Tiene experiencia.", "grounding": "portfolio"}
    )
    assert part.grounding == "portfolio"


def test_rejects_legacy_record_and_claim_ids() -> None:
    with pytest.raises(CandidateValidationError):
        validate_candidate(
            {"type": "text", "text": "x", "grounding": "portfolio", "record_ids": []}
        )


def test_citations_are_server_owned_and_deduplicated() -> None:
    parts = citations_to_parts(
        [PdfCitation("cv.pdf", 1), PdfCitation("cv.pdf", 1), PdfCitation("cv.pdf", 2)]
    )
    assert parts == [SourcePart(filename="cv.pdf", page=1), SourcePart(filename="cv.pdf", page=2)]
