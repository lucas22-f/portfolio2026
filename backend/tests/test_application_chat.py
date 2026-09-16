import pytest

from app.application.chat import (
    CandidateValidationError,
    SourcePart,
    citations_to_parts,
    validate_candidate,
)
from app.application.chat_graph import run_chat_graph
from app.infrastructure.chat_provider import ProviderFailure, ProviderResult, ToolCall
from app.infrastructure.pdf_rag import PdfChunk, PdfCitation, PdfSearchResult


class _Retriever:
    content_version = "test"

    def search(self, query: str, *, top_k: int = 3) -> list[PdfSearchResult]:
        assert query == "Lucas"
        assert top_k == 3
        return [PdfSearchResult(PdfChunk("chunk-1", "evidence", 1, "cv.pdf"), 0.1)]


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


@pytest.mark.asyncio
async def test_initial_candidate_never_streams_before_final_grounding_validation() -> None:
    deltas: list[str] = []

    async def invoke(*args: object) -> ProviderResult:
        callback = args[-1]
        if callable(callback):
            callback("validated preview")
        return ProviderResult(
            [{"type": "text", "text": "Respuesta general.", "grounding": "general"}],
            total_tokens=1,
        )

    class Retriever:
        content_version = "test"

        def search(self, query: str, *, top_k: int = 3) -> list[object]:
            del query, top_k
            return []

    result = await run_chat_graph(
        {
            "message": "Pregunta general",
            "invoke_model": invoke,
            "retriever": Retriever(),  # type: ignore[typeddict-item]
            "on_text_delta": deltas.append,
        }
    )

    assert result["parts"][0].text == "Respuesta general."  # type: ignore[index,union-attr]
    assert deltas == []


@pytest.mark.asyncio
async def test_grounded_invalid_completion_retries_once_with_cumulative_usage() -> None:
    deltas: list[str] = []
    calls: list[tuple[object, ...]] = []
    tool_call = ToolCall("Lucas", "call-1", '{"query":"Lucas"}')

    async def invoke(*args: object) -> ProviderResult:
        calls.append(args)
        if len(calls) == 1:
            return ProviderResult(
                [], total_tokens=7, tool_call=tool_call, total_input_tokens=5, total_output_tokens=2
            )
        callback = args[-1]
        assert callable(callback)
        if len(calls) == 2:
            callback("descartar")
            raise ProviderFailure(
                "invalid-provider-output",
                retryable=False,
                total_input_tokens=11,
                total_output_tokens=5,
            )
        assert args[3:5] == (11, 5)
        callback("validada")
        return ProviderResult(
            [{"type": "text", "text": "Respuesta validada.", "grounding": "portfolio"}],
            total_tokens=20,
            total_input_tokens=15,
            total_output_tokens=7,
        )

    result = await run_chat_graph(
        {
            "message": "¿Quién es Lucas?",
            "invoke_model": invoke,
            "retriever": _Retriever(),
            "on_text_delta": deltas.append,
        }
    )

    assert len(calls) == 3
    assert "error" not in result
    assert [part.text for part in result["parts"] if part.type == "text"] == ["Respuesta validada."]
    assert deltas == ["validada"]


@pytest.mark.asyncio
async def test_grounded_invalid_completion_stops_after_one_retry() -> None:
    calls = 0
    tool_call = ToolCall("Lucas", "call-1", '{"query":"Lucas"}')

    async def invoke(*args: object) -> ProviderResult:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ProviderResult(
                [], total_tokens=7, tool_call=tool_call, total_input_tokens=5, total_output_tokens=2
            )
        raise ProviderFailure(
            "invalid-provider-output",
            retryable=False,
            total_input_tokens=10 + calls,
            total_output_tokens=4 + calls,
        )

    result = await run_chat_graph(
        {"message": "¿Quién es Lucas?", "invoke_model": invoke, "retriever": _Retriever()}
    )

    assert calls == 3
    assert isinstance(result["error"], ProviderFailure)
    assert result["error"].code == "invalid-provider-output"


@pytest.mark.asyncio
async def test_grounded_non_validation_failure_does_not_retry() -> None:
    calls = 0
    tool_call = ToolCall("Lucas", "call-1", '{"query":"Lucas"}')

    async def invoke(*args: object) -> ProviderResult:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ProviderResult(
                [], total_tokens=7, tool_call=tool_call, total_input_tokens=5, total_output_tokens=2
            )
        raise ProviderFailure("provider-timeout", retryable=True)

    result = await run_chat_graph(
        {"message": "¿Quién es Lucas?", "invoke_model": invoke, "retriever": _Retriever()}
    )

    assert calls == 2
    assert isinstance(result["error"], ProviderFailure)
    assert result["error"].code == "provider-timeout"
