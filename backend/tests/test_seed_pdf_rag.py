import os
from unittest.mock import patch

import pytest

from scripts import seed_pdf_rag


def test_local_environment_loads_missing_values_without_replacing_shell_values(
    tmp_path, monkeypatch
) -> None:
    environment_file = tmp_path / ".env"
    environment_file.write_text(
        "SUPABASE_DB_URL=database-from-file\nOPENAI_API_KEY=key-from-file\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "key-from-shell")
    monkeypatch.setattr(seed_pdf_rag, "_ENV_FILE", environment_file)

    seed_pdf_rag._load_local_environment()

    assert os.environ["SUPABASE_DB_URL"] == "database-from-file"
    assert os.environ["OPENAI_API_KEY"] == "key-from-shell"


def test_main_loads_local_environment_before_reading_required_configuration(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)

    with (
        patch("scripts.seed_pdf_rag.load_dotenv") as load_dotenv,
        pytest.raises(KeyError, match="SUPABASE_DB_URL"),
    ):
        seed_pdf_rag.main()

    load_dotenv.assert_called_once_with(seed_pdf_rag._ENV_FILE)
