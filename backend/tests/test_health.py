from fastapi.testclient import TestClient

from app.infrastructure.chat_provider import FakeProvider
from app.main import create_app


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
