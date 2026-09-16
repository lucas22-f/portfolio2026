"""HTTP tests for the v5 PDF-grounded SSE contract."""

from __future__ import annotations

import json
import logging

from fastapi.testclient import TestClient
from pytest import LogCaptureFixture

from app.infrastructure.chat_provider import ChatProvider, ProviderResult, ToolCall
from app.infrastructure.pdf_rag import PdfChunk, PdfSearchResult
from app.main import create_app


class FakeRetriever:
    content_version = "pdf-test-version"

    def __init__(self, results: list[PdfSearchResult] | None = None) -> None:
        self.results = results or []

    def search(self, query: str, *, top_k: int = 3) -> list[PdfSearchResult]:
        del query, top_k
        return self.results


class ToolThenAnswerProvider(ChatProvider):
    def __init__(self, answer: dict[str, object] | None = None) -> None:
        self.answer = answer
        self.calls = 0

    def generate(self, *args: object, **kwargs: object) -> ProviderResult:
        del args, kwargs
        self.calls += 1
        if self.calls == 1:
            return ProviderResult(
                [], total_tokens=0, tool_call=ToolCall("consulta", "call-1", '{"query":"consulta"}')
            )
        return ProviderResult([self.answer] if self.answer else [], total_tokens=0)


def _events(response: object) -> list[dict[str, object]]:
    return [
        json.loads(frame.splitlines()[1][6:])
        for frame in response.text.split("\n\n")  # type: ignore[attr-defined]
        if frame
    ]


def test_pdf_grounded_response_emits_filename_page_citations() -> None:
    result = PdfSearchResult(
        PdfChunk("chunk-1", "Python experience", 2, "CV_Lucas_Figueroa_1.pdf"), 0.1
    )
    provider = ToolThenAnswerProvider(
        {"type": "text", "text": "Tiene experiencia en Python.", "grounding": "portfolio"}
    )
    client = TestClient(
        create_app(
            retriever=FakeRetriever([result]), provider=provider, content_version="static-version"
        )
    )

    response = client.post(
        "/api/v1/chat/stream",
        json={"message": "¿Python?", "locale": "es", "client_request_id": "pdf-1"},
    )
    events = _events(response)

    assert [event["type"] for event in events] == ["start", "tool", "part", "part", "done"]
    assert events[0]["protocol_version"] == "5"
    assert events[0]["content_version"] == "static-version"
    assert events[3]["part"] == {"type": "source", "filename": "CV_Lucas_Figueroa_1.pdf", "page": 2}


def test_no_relevant_pdf_result_uses_safe_fallback() -> None:
    client = TestClient(
        create_app(
            retriever=FakeRetriever(),
            provider=ToolThenAnswerProvider(),
            content_version="static-version",
        )
    )
    events = _events(
        client.post(
            "/api/v1/chat/stream",
            json={"message": "¿Tema inexistente?", "locale": "es", "client_request_id": "pdf-2"},
        )
    )
    assert events[2]["part"]["text"] == "No encontré información del portfolio sobre ese tema."


def test_chat_observability_logs_are_payload_free(caplog: LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    secret_prompt = "private prompt must not be logged"
    result = PdfSearchResult(PdfChunk("chunk-1", "private PDF chunk", 7, "CV.pdf"), 0.1)
    client = TestClient(
        create_app(
            retriever=FakeRetriever([result]),
            provider=ToolThenAnswerProvider(
                {"type": "text", "text": "private model text", "grounding": "portfolio"}
            ),
            content_version="static-version",
        )
    )

    client.post(
        "/api/v1/chat/stream",
        json={"message": secret_prompt, "locale": "es", "client_request_id": "log-1"},
    )

    messages = "\n".join(record.getMessage() for record in caplog.records)
    assert "chat.request_accepted" in messages
    assert "chat.sse_event_emitted" in messages
    assert '"event_type": "done"' in messages
    assert secret_prompt not in messages
    assert "private PDF chunk" not in messages
    assert "private model text" not in messages
