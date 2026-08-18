from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI

from app.main import _default_app

_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


def _development_app() -> FastAPI:
    """Build the local application from an ignored .env without overriding shell values."""
    load_dotenv(_ENV_FILE)
    return _default_app()


app = _development_app()


def main() -> None:
    """Run the API locally with automatic reload."""
    uvicorn.run(
        "app.dev:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
