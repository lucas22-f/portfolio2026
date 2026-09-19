import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI

from app.main import _default_app

_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
# Local-only observability sink: payload-free chat lifecycle records persist here.
_LOG_FILE = Path(__file__).resolve().parents[1] / "logs" / "local-api.log"


def _configure_file_logging() -> None:
    """Attach a rotating file handler to the app logger (local dev only)."""
    _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    app_logger = logging.getLogger("app")
    for handler in app_logger.handlers:
        if isinstance(handler, RotatingFileHandler) and Path(handler.baseFilename) == _LOG_FILE:
            return
    file_handler = RotatingFileHandler(
        _LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    app_logger.addHandler(file_handler)
    if app_logger.level > logging.INFO or app_logger.level == logging.NOTSET:
        app_logger.setLevel(logging.INFO)


_configure_file_logging()


def _development_app() -> FastAPI:
    """Build the local application from an ignored .env without overriding shell values."""
    load_dotenv(_ENV_FILE)
    return _default_app(debug=True)


app = _development_app()


def main() -> None:
    """Run the API locally with automatic reload."""
    _configure_file_logging()
    uvicorn.run(
        "app.dev:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
