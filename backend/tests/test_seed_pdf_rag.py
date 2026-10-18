import os
from pathlib import Path
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


class _AlreadyActiveDatabase:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def cursor(self):
        return self

    def execute(self, statement: str, _params=None) -> None:
        self.statements.append(statement)

    def fetchone(self):
        return ("active-version",)


def _configure_already_active_pdf(monkeypatch, pdf_path_override: str | None):
    selected_paths = []
    database = _AlreadyActiveDatabase()
    monkeypatch.setattr(seed_pdf_rag, "_load_local_environment", lambda: None)
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://example.invalid/test")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_EMBEDDING_MODEL", seed_pdf_rag.EMBEDDING_MODEL)
    if pdf_path_override is None:
        monkeypatch.delenv("PDF_RAG_PDF_PATH", raising=False)
    else:
        monkeypatch.setenv("PDF_RAG_PDF_PATH", pdf_path_override)

    def record_path(path):
        selected_paths.append(Path(path))
        return "a" * 64

    def record_chunks_path(path):
        selected_paths.append(Path(path))
        return []

    monkeypatch.setattr(seed_pdf_rag, "_sha256", record_path)
    monkeypatch.setattr(seed_pdf_rag, "extract_pdf_chunks", record_chunks_path)
    monkeypatch.setattr(seed_pdf_rag, "OpenAIEmbedder", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(seed_pdf_rag.psycopg, "connect", lambda _url: database)
    return selected_paths, database


def test_main_defaults_to_the_downloadable_cv_without_writing_when_already_active(
    monkeypatch, capsys
) -> None:
    selected_paths, database = _configure_already_active_pdf(monkeypatch, None)

    seed_pdf_rag.main()

    expected_pdf = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "public"
        / "downloads"
        / "CV_Lucas_Figueroa.pdf"
    )
    assert selected_paths == [expected_pdf, expected_pdf]
    assert capsys.readouterr().out == (
        "The matching PDF version is already active; no changes made.\n"
    )
    assert len(database.statements) == 2
    assert all(
        "INSERT INTO" not in query and "UPDATE app.pdf_versions" not in query
        for query in database.statements
    )


def test_main_preserves_explicit_pdf_path_override_without_writing_when_already_active(
    monkeypatch, capsys
) -> None:
    override = "alternate/cv.pdf"
    selected_paths, database = _configure_already_active_pdf(monkeypatch, override)

    seed_pdf_rag.main()

    expected_pdf = Path(override)
    assert selected_paths == [expected_pdf, expected_pdf]
    assert capsys.readouterr().out == (
        "The matching PDF version is already active; no changes made.\n"
    )
    assert len(database.statements) == 2
    assert all(
        "INSERT INTO" not in query and "UPDATE app.pdf_versions" not in query
        for query in database.statements
    )
