"""Static deployment contracts for the repository-root Vercel/Railway topology."""

from __future__ import annotations

import json
from pathlib import Path

from app.main import DEFAULT_ORIGINS, DEFAULT_PREVIEW_ORIGIN_REGEX, _configured_origins, _configured_preview_origin_regex


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_vercel_builds_the_frontend_from_repository_root() -> None:
    config = json.loads((REPOSITORY_ROOT / "vercel.json").read_text(encoding="utf-8"))

    assert config["installCommand"] == "cd frontend && npm ci"
    assert config["buildCommand"] == "cd frontend && npx ng build --define __API_BASE_URL__=\"'$API_BASE_URL'\""
    assert config["outputDirectory"] == "frontend/dist/frontend/browser"


def test_railway_dockerfile_packages_backend_and_reviewed_content() -> None:
    railway = json.loads((REPOSITORY_ROOT / "railway.json").read_text(encoding="utf-8"))
    dockerfile = (REPOSITORY_ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")

    assert railway["build"] == {"builder": "DOCKERFILE", "dockerfilePath": "backend/Dockerfile"}
    assert railway["deploy"]["healthcheckPath"] == "/health"
    assert "COPY backend/pyproject.toml backend/poetry.lock ./" in dockerfile
    assert "COPY backend/README.md ./" in dockerfile
    assert dockerfile.index("COPY backend/README.md ./") < dockerfile.index("poetry install")
    assert "poetry install --only main --sync --no-interaction" in dockerfile
    assert "COPY backend/app ./app" in dockerfile
    assert "COPY content/v1 /app/content/v1" in dockerfile
    assert 'CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]' in dockerfile


def test_deployment_environment_templates_keep_api_and_cors_values_non_secret() -> None:
    frontend_environment = (REPOSITORY_ROOT / "frontend" / ".env.example").read_text(encoding="utf-8")
    backend_environment = (REPOSITORY_ROOT / "backend" / ".env.example").read_text(encoding="utf-8")

    assert "API_BASE_URL=http://localhost:8000" in frontend_environment
    assert "CORS_ALLOWED_ORIGINS=http://localhost:4200,https://portfolio2026.vercel.app" in backend_environment
    assert "CORS_PREVIEW_ORIGIN_REGEX=^https://portfolio2026(?:-[a-z0-9-]+)?\\.vercel\\.app$" in backend_environment
    assert "OPENAI_API_KEY=" in backend_environment


def test_cors_origins_accept_only_explicit_environment_values() -> None:
    assert _configured_origins("https://preview.example,http://localhost:4200") == (
        "https://preview.example",
        "http://localhost:4200",
    )
    assert _configured_origins("  ") == DEFAULT_ORIGINS
    assert _configured_origins("*,https://preview.example") == ("https://preview.example",)
    assert _configured_preview_origin_regex("^https://.*\\.example$") == DEFAULT_PREVIEW_ORIGIN_REGEX
