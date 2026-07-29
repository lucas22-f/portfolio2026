from pathlib import Path

import uvicorn
from fastapi import FastAPI

from app.domain.content import load_content_bundle
from app.infrastructure.chat_provider import FakeProvider
from app.main import create_app


def _development_app() -> FastAPI:
    """Build a credential-free local application with deterministic chat responses."""
    content_root = Path(__file__).resolve().parents[2] / "content" / "v1"
    return create_app(bundle=load_content_bundle(content_root), provider=FakeProvider())


app = _development_app()


def main() -> None:
    """Run the API locally with automatic reload."""
    uvicorn.run(
        "app.dev:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
