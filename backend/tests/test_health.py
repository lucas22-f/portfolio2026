import logging

from fastapi.testclient import TestClient

from app.infrastructure.chat_provider import FakeProvider
from app import main
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


def test_missing_supabase_configuration_makes_default_app_unavailable(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    client = TestClient(_default_app())

    assert client.get("/health").status_code == 503
    assert client.get("/api/v1/metadata").status_code == 503


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

    def fail_retriever(*args, **kwargs):
        raise ValueError("sensitive exception detail")

    monkeypatch.setattr(main, "SupabasePdfRetriever", fail_retriever)

    with caplog.at_level(logging.ERROR, logger="app.main"):
        client = TestClient(_default_app())

    assert client.get("/health").status_code == 503
    assert "startup_readiness_failed stage=retriever error_type=ValueError" in caplog.text
    assert "sensitive exception detail" not in caplog.text
    assert "sensitive-openai-key" not in caplog.text
    assert "sensitive-dsn" not in caplog.text
