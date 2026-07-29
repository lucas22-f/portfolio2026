from unittest.mock import patch

from fastapi.testclient import TestClient

from app.dev import main


def test_main_starts_reloadable_local_server() -> None:
    with patch("app.dev.uvicorn.run") as run:
        main()

    run.assert_called_once_with(
        "app.dev:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )


def test_development_app_uses_fake_provider_without_credentials() -> None:
    from app.dev import app

    client = TestClient(app)

    assert client.get("/health").status_code == 200
    assert client.get("/api/v1/metadata").json()["model"] == "fake"
