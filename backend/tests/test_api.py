"""HTTP tests for the v5 PDF-grounded SSE contract."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from pytest import LogCaptureFixture

from app.application.chat_admission import (
    AdmissionDecision,
    ChatAdmissionConfig,
    ChatAdmissionGuard,
)
from app.application.contact import EphemeralSubmissionGuard
from app.infrastructure.chat_provider import ChatProvider, ProviderResult, ToolCall
from app.infrastructure.pdf_rag import PdfChunk, PdfSearchResult
from app.main import ChatRequest, create_app


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


class GeneralProvider(ChatProvider):
    def __init__(self) -> None:
        self.calls = 0

    def generate(self, *args: object, **kwargs: object) -> ProviderResult:
        del args, kwargs
        self.calls += 1
        return ProviderResult(
            [
                {
                    "type": "text",
                    "text": "Podemos conversar sobre la oportunidad.",
                    "grounding": "general",
                }
            ],
            total_tokens=3,
        )


class FakeDelivery:
    def __init__(self) -> None:
        self.calls = 0

    def deliver(self, submission: object) -> None:
        del submission
        self.calls += 1


def _contact_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "submission_version": "1",
        "name": "Private Name",
        "email": "private@example.com",
        "company": None,
        "message": "Private interview message",
    }
    payload.update(overrides)
    return payload


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


def test_metadata_and_chat_negotiate_schema_only_contact_form() -> None:
    delivery = FakeDelivery()
    client = TestClient(
        create_app(
            retriever=FakeRetriever(),
            provider=GeneralProvider(),
            content_version="static-version",
            contact_enabled=True,
            contact_delivery=delivery,
            contact_guard=EphemeralSubmissionGuard("test-secret"),
        )
    )
    metadata = client.get("/api/v1/metadata").json()
    assert metadata["capabilities"] == {
        "interview_contact_form": "1",
        "contact_submission": "1",
    }
    response = client.post(
        "/api/v1/chat/stream",
        json={
            "message": "Quiero coordinar una entrevista",
            "locale": "es",
            "client_request_id": "contact-chat-1",
            "capabilities": {"interview_contact_form": "1", "contact_submission": "1"},
        },
    )
    events = _events(response)
    assert [event["type"] for event in events] == ["start", "part", "part", "done"]
    assert events[2]["part"] == {
        "type": "interview_contact_form",
        "form_version": "1",
        "submission_version": "1",
        "intent": "interview",
        "fields": ["name", "email", "company", "message"],
    }


def test_contact_form_falls_back_to_text_only_without_capability_or_clear_intent() -> None:
    client = TestClient(
        create_app(
            retriever=FakeRetriever(),
            provider=GeneralProvider(),
            content_version="static-version",
            contact_enabled=True,
            contact_delivery=FakeDelivery(),
            contact_guard=EphemeralSubmissionGuard("test-secret"),
        )
    )
    for request_id, message, capabilities in (
        ("old-client", "Quiero una entrevista", None),
        ("ambiguous", "Me gusta tu portfolio", {"interview_contact_form": "1"}),
        ("refusal", "No me contactes para una entrevista", {"interview_contact_form": "1"}),
    ):
        body: dict[str, object] = {
            "message": message,
            "locale": "es",
            "client_request_id": request_id,
        }
        if capabilities:
            body["capabilities"] = capabilities
        assert all(
            event.get("part", {}).get("type") != "interview_contact_form"  # type: ignore[union-attr]
            for event in _events(client.post("/api/v1/chat/stream", json=body))
        )


def test_contact_endpoint_delivers_once_and_replays_as_duplicate() -> None:
    delivery = FakeDelivery()
    client = TestClient(
        create_app(
            retriever=FakeRetriever(),
            provider=GeneralProvider(),
            contact_enabled=True,
            contact_delivery=delivery,
            contact_guard=EphemeralSubmissionGuard("test-secret"),
        )
    )
    key = str(uuid.uuid4())
    first = client.post(
        "/api/v1/contact/submissions",
        json=_contact_payload(),
        headers={"Idempotency-Key": key},
    )
    replay = client.post(
        "/api/v1/contact/submissions",
        json=_contact_payload(),
        headers={"Idempotency-Key": key},
    )
    assert first.status_code == 200 and first.json()["outcome"] == "accepted"
    assert replay.status_code == 200 and replay.json()["outcome"] == "duplicate_accepted"
    assert delivery.calls == 1


def test_contact_endpoint_rejects_bad_boundaries_without_delivery() -> None:
    delivery = FakeDelivery()
    client = TestClient(
        create_app(
            retriever=FakeRetriever(),
            provider=GeneralProvider(),
            contact_enabled=True,
            contact_delivery=delivery,
            contact_guard=EphemeralSubmissionGuard("test-secret", rate_limit=1),
        )
    )
    key = str(uuid.uuid4())
    assert (
        client.post(
            "/api/v1/contact/submissions", content=b"{}", headers={"content-type": "text/plain"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/contact/submissions",
            content=b"x" * 9000,
            headers={"content-type": "application/json"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/contact/submissions",
            json=_contact_payload(extra="bad"),
            headers={"Idempotency-Key": key},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/contact/submissions",
            json=_contact_payload(submission_version="2"),
            headers={"Idempotency-Key": key},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/contact/submissions",
            json=_contact_payload(),
            headers={"Idempotency-Key": "not-a-uuid"},
        ).status_code
        == 400
    )
    assert delivery.calls == 0


def test_disabled_contact_is_safe_and_privacy_logs_are_payload_free(
    caplog: LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    provider = GeneralProvider()
    client = TestClient(create_app(retriever=FakeRetriever(), provider=provider))
    response = client.post(
        "/api/v1/contact/submissions",
        json=_contact_payload(),
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    serialized = "\n".join(record.getMessage() for record in caplog.records)
    assert response.status_code == 503
    assert response.json()["outcome"] == "delivery_unavailable"
    assert provider.calls == 0
    for secret in ("Private Name", "private@example.com", "Private interview message"):
        assert secret not in serialized
        assert secret not in response.text


class RejectingAdmissionGuard(ChatAdmissionGuard):
    def __init__(self, reason: str) -> None:
        super().__init__(ChatAdmissionConfig(retry_after_seconds=5), secret=b"test-secret")
        self.reason = reason

    def try_admit(self, transport_peer: str | None) -> AdmissionDecision:
        del transport_peer
        return AdmissionDecision(False, self.reason)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "reason",
    [
        "frequency",
        "peer_concurrency",
        "process_concurrency",
        "state_capacity",
        "missing_peer",
    ],
)
def test_chat_admission_rejection_is_stable_private_and_before_work(reason: str) -> None:
    retriever = FakeRetriever()
    provider = GeneralProvider()
    client = TestClient(
        create_app(
            retriever=retriever,
            provider=provider,
            chat_admission=RejectingAdmissionGuard(reason),
        )
    )
    secret = "private prompt must not escape"

    response = client.post(
        "/api/v1/chat/stream",
        json={"message": secret, "locale": "es", "client_request_id": "rejected-1"},
        headers={"X-Forwarded-For": "198.51.100.20", "Forwarded": "for=198.51.100.21"},
    )

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "5"
    assert response.json() == {
        "code": "throttled",
        "message": "El servicio está temporalmente ocupado. Intentá nuevamente en unos segundos.",
        "retryable": True,
        "retry_after_seconds": 5,
    }
    assert secret not in response.text
    assert "198.51.100" not in response.text
    assert provider.calls == 0


def test_forwarded_headers_do_not_bypass_transport_peer_frequency_limit() -> None:
    guard = ChatAdmissionGuard(
        ChatAdmissionConfig(rate_limit=1), secret=b"test-secret"
    )
    client = TestClient(
        create_app(retriever=FakeRetriever(), provider=GeneralProvider(), chat_admission=guard)
    )
    body = {"message": "Hola", "locale": "es", "client_request_id": "forwarded-1"}

    first = client.post(
        "/api/v1/chat/stream", json=body, headers={"X-Forwarded-For": "198.51.100.1"}
    )
    body["client_request_id"] = "forwarded-2"
    second = client.post(
        "/api/v1/chat/stream", json=body, headers={"Forwarded": "for=198.51.100.2"}
    )

    assert first.status_code == 200
    assert second.status_code == 429


class FailingProvider(ChatProvider):
    def generate(self, *args: object, **kwargs: object) -> ProviderResult:
        del args, kwargs
        raise RuntimeError("internal provider failure")


@pytest.mark.parametrize("provider", [GeneralProvider(), FailingProvider()])
def test_stream_terminal_paths_release_single_process_slot(provider: ChatProvider) -> None:
    guard = ChatAdmissionGuard(
        ChatAdmissionConfig(process_concurrency=1), secret=b"test-secret"
    )
    client = TestClient(
        create_app(retriever=FakeRetriever(), provider=provider, chat_admission=guard)
    )

    for request_id in ("cleanup-1", "cleanup-2"):
        response = client.post(
            "/api/v1/chat/stream",
            json={"message": "Hola", "locale": "es", "client_request_id": request_id},
        )
        assert response.status_code == 200


def test_cancelled_stream_releases_single_process_slot() -> None:
    guard = ChatAdmissionGuard(
        ChatAdmissionConfig(process_concurrency=1), secret=b"test-secret"
    )
    application = create_app(
        retriever=FakeRetriever(), provider=GeneralProvider(), chat_admission=guard
    )
    route = next(
        route for route in application.routes if route.path == "/api/v1/chat/stream"  # type: ignore[attr-defined]
    )
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/v1/chat/stream",
        "query_string": b"",
        "headers": [],
        "client": ("test-peer", 1234),
        "server": ("testserver", 80),
    }

    async def cancel_after_start() -> None:
        response = await route.endpoint(  # type: ignore[attr-defined]
            chat_request=ChatRequest(
                message="Hola", locale="es", client_request_id="cancelled-1"
            ),
            request=Request(scope),
        )
        iterator = response.body_iterator
        await iterator.__anext__()  # type: ignore[attr-defined]
        await iterator.aclose()  # type: ignore[attr-defined]

    asyncio.run(cancel_after_start())

    assert guard.try_admit("test-peer").accepted


def test_contact_forwarded_headers_do_not_bypass_authoritative_peer_limit() -> None:
    delivery = FakeDelivery()
    client = TestClient(
        create_app(
            retriever=FakeRetriever(),
            provider=GeneralProvider(),
            contact_enabled=True,
            contact_delivery=delivery,
            contact_guard=EphemeralSubmissionGuard("test-secret", rate_limit=1),
        )
    )

    first = client.post(
        "/api/v1/contact/submissions",
        json=_contact_payload(),
        headers={"Idempotency-Key": str(uuid.uuid4()), "X-Forwarded-For": "198.51.100.1"},
    )
    second = client.post(
        "/api/v1/contact/submissions",
        json=_contact_payload(message="Another message"),
        headers={"Idempotency-Key": str(uuid.uuid4()), "Forwarded": "for=198.51.100.2"},
    )

    assert first.status_code == 200
    assert second.status_code == 429
    assert delivery.calls == 1
