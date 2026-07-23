from unittest.mock import patch

from app.dev import main


def test_main_starts_reloadable_local_server() -> None:
    with patch("app.dev.uvicorn.run") as run:
        main()

    run.assert_called_once_with(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
