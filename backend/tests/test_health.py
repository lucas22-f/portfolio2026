from fastapi.testclient import TestClient

from app.infrastructure.chat_provider import FakeProvider
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
