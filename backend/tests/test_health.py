from pathlib import Path

from fastapi.testclient import TestClient

from app.domain.content import load_content_bundle
from app.infrastructure.chat_provider import FakeProvider
from app.main import create_app


def test_health_reports_initialized_application_versions() -> None:
    bundle = load_content_bundle(Path(__file__).resolve().parents[2] / "content" / "v1")
    response = TestClient(
        create_app(bundle=bundle, provider=FakeProvider(), app_version="health-test")
    ).get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "app_version": "health-test",
        "content_version": bundle.portfolio.content_version,
    }
