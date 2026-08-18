from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import dev


def test_main_starts_reloadable_local_server() -> None:
    with patch("app.dev.uvicorn.run") as run:
        dev.main()

    run.assert_called_once_with(
        "app.dev:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )


def test_development_app_loads_local_openai_configuration(tmp_path: Path, monkeypatch) -> None:
    environment_file = tmp_path / ".env"
    environment_file.write_text(
        "OPENAI_API_KEY=test-key\nOPENAI_MODEL=test-model\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.setattr(dev, "_ENV_FILE", environment_file)

    client = TestClient(dev._development_app())

    assert client.get("/health").status_code == 200
    assert client.get("/api/v1/metadata").json()["model"] == "test-model"


def test_development_app_is_unavailable_without_openai_key(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(dev, "_ENV_FILE", tmp_path / ".env")

    client = TestClient(dev._development_app())

    assert client.get("/health").status_code == 503
