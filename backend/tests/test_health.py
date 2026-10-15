import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from psycopg import OperationalError

from app import main
from app.infrastructure.chat_provider import FakeProvider
from app.infrastructure.pdf_rag import PdfRetrievalTransientError, SupabasePdfRetriever
from app.main import _default_app, create_app


class FakeRetriever:
    content_version = "pdf-health-version"

    def search(self, query: str, *, top_k: int = 3) -> list[object]:
        del query, top_k
        return []


def test_health_reports_initialized_application_versions() -> None:
    response = TestClient(
        create_app(
            retriever=FakeRetriever(),
            provider=FakeProvider(),
            content_version="static-content-version",
            app_version="health-test",
        )
    ).get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "app_version": "health-test",
        "content_version": "static-content-version",
    }


def test_missing_supabase_configuration_stays_unavailable_with_safe_log(
    monkeypatch, caplog
) -> None:
    monkeypatch.setattr(main.ChatAdmissionGuard, "from_environment", lambda environ: object())
    monkeypatch.setenv("CHAT_SERVICE_TOKEN", "sensitive-service-token")
    monkeypatch.setenv("OPENAI_API_KEY", "sensitive-openai-key")
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
    monkeypatch.setattr(main, "OpenAIChatProvider", lambda **kwargs: FakeProvider())

    with caplog.at_level(logging.ERROR, logger="app.main"):
        client = TestClient(_default_app())

    assert client.get("/health").status_code == 503
    assert client.get("/api/v1/metadata").status_code == 503
    assert "startup_readiness_failed stage=retriever error_type=KeyError" in caplog.text
    assert "sensitive-service-token" not in caplog.text
    assert "sensitive-openai-key" not in caplog.text


def test_missing_startup_configuration_logs_stage_without_sensitive_values(
    monkeypatch, caplog
) -> None:
    monkeypatch.setattr(main.ChatAdmissionGuard, "from_environment", lambda environ: object())
    monkeypatch.delenv("CHAT_SERVICE_TOKEN", raising=False)

    with caplog.at_level(logging.ERROR, logger="app.main"):
        client = TestClient(_default_app())

    assert client.get("/health").status_code == 503
    assert "startup_readiness_failed stage=service_token error_type=KeyError" in caplog.text
    assert "sensitive" not in caplog.text
    assert "CHAT_SERVICE_TOKEN" not in caplog.text


def test_retriever_startup_failure_logs_safe_diagnostic_and_stays_unready(
    monkeypatch, caplog
) -> None:
    monkeypatch.setattr(main.ChatAdmissionGuard, "from_environment", lambda environ: object())
    monkeypatch.setenv("CHAT_SERVICE_TOKEN", "sensitive-service-token")
    monkeypatch.setenv("OPENAI_API_KEY", "sensitive-openai-key")
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://sensitive-dsn")
    monkeypatch.setattr(main, "OpenAIChatProvider", lambda **kwargs: FakeProvider())

    attempts = 0

    def fail_retriever(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        raise ValueError("sensitive exception detail")

    monkeypatch.setattr(main, "SupabasePdfRetriever", fail_retriever)

    with caplog.at_level(logging.ERROR, logger="app.main"):
        client = TestClient(_default_app())

    assert client.get("/health").status_code == 503
    assert client.get("/api/v1/metadata").status_code == 503
    assert attempts == 1
    assert "startup_readiness_failed stage=retriever error_type=ValueError" in caplog.text
    assert "sensitive exception detail" not in caplog.text
    assert "sensitive-openai-key" not in caplog.text
    assert "sensitive-dsn" not in caplog.text


def test_supabase_connection_failure_is_typed_as_transient() -> None:
    def fail_connect(*args, **kwargs):
        raise OperationalError("sensitive connection detail")

    with pytest.raises(PdfRetrievalTransientError) as error:
        SupabasePdfRetriever(
            "postgresql://sensitive-dsn",
            object(),  # type: ignore[arg-type]
            connect=fail_connect,
        )

    assert "sensitive connection detail" not in str(error.value)
    assert "sensitive-dsn" not in str(error.value)


@pytest.mark.parametrize("readiness_path", ["/health", "/api/v1/metadata"])
def test_transient_retriever_startup_failure_recovers_on_readiness_poll(
    monkeypatch, caplog, readiness_path: str
) -> None:
    monkeypatch.setattr(main.ChatAdmissionGuard, "from_environment", lambda environ: object())
    monkeypatch.setenv("CHAT_SERVICE_TOKEN", "sensitive-service-token")
    monkeypatch.setenv("OPENAI_API_KEY", "sensitive-openai-key")
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://sensitive-dsn")
    monkeypatch.setattr(main, "OpenAIChatProvider", lambda **kwargs: FakeProvider())
    attempts = 0

    def recoverable_retriever(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise PdfRetrievalTransientError("sensitive connection detail")
        return FakeRetriever()

    monkeypatch.setattr(main, "SupabasePdfRetriever", recoverable_retriever)

    with caplog.at_level(logging.ERROR, logger="app.main"):
        client = TestClient(_default_app())
        assert attempts == 1
        response = client.get(readiness_path)

    assert response.status_code == 200
    assert attempts == 2
    assert client.get("/health").status_code == 200
    metadata = client.get("/api/v1/metadata")
    assert metadata.status_code == 200
    assert (
        metadata.json()["content_version"]
        == main.load_content_bundle(
            Path(__file__).resolve().parents[2] / "content" / "v1"
        ).portfolio.content_version
    )
    assert "startup_readiness_failed stage=retriever error_type=PdfRetrievalTransientError" in (
        caplog.text
    )
    assert "sensitive connection detail" not in caplog.text
    assert "sensitive-service-token" not in caplog.text
    assert "sensitive-openai-key" not in caplog.text
    assert "sensitive-dsn" not in caplog.text
