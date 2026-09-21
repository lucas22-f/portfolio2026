"""Manually publish the current portfolio PDF to Supabase pgvector."""

from __future__ import annotations

import hashlib
import os
from collections.abc import Sequence
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from app.infrastructure.pdf_rag import OpenAIEmbedder, PdfRetrievalError, extract_pdf_chunks

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
EMBEDDING_BATCH_SIZE = 50
_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


def _sha256(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _vector_literal(vector: Sequence[float]) -> str:
    if len(vector) != EMBEDDING_DIMENSIONS:
        raise PdfRetrievalError("embedding dimensions do not match pgvector(1536)")
    return "[" + ",".join(str(float(value)) for value in vector) + "]"


def _load_local_environment() -> None:
    """Load the ignored backend environment without replacing shell values."""
    load_dotenv(_ENV_FILE)


def main() -> None:
    _load_local_environment()
    database_url = os.environ["SUPABASE_DB_URL"]
    api_key = os.environ["OPENAI_API_KEY"]
    configured_model = os.getenv("OPENAI_EMBEDDING_MODEL", EMBEDDING_MODEL)
    if configured_model != EMBEDDING_MODEL:
        raise ValueError("only text-embedding-3-small is compatible with pgvector(1536)")

    pdf_path = Path(
        os.getenv(
            "PDF_RAG_PDF_PATH",
            str(Path(__file__).resolve().parents[1] / "app" / "docs" / "CV_Lucas_Figueroa_1.pdf"),
        )
    )
    source_sha256 = _sha256(pdf_path)
    chunks = extract_pdf_chunks(pdf_path)
    embedder = OpenAIEmbedder(api_key, model=configured_model)

    with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext('portfolio-pdf-rag'))")
        cursor.execute(
            """
                SELECT id FROM app.pdf_versions
                WHERE is_active AND source_sha256 = %s
                  AND embedding_model = %s AND embedding_dimensions = %s
                """,
            (source_sha256, configured_model, EMBEDDING_DIMENSIONS),
        )
        if cursor.fetchone() is not None:
            print("The matching PDF version is already active; no changes made.")
            return
        cursor.execute(
            """
                INSERT INTO app.pdf_versions (
                    source_sha256, filename, embedding_model, embedding_dimensions
                ) VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
            (source_sha256, pdf_path.name, configured_model, EMBEDDING_DIMENSIONS),
        )
        version_row = cursor.fetchone()
        if version_row is None:
            raise RuntimeError("could not create a PDF version")
        version_id = version_row[0]
        for start in range(0, len(chunks), EMBEDDING_BATCH_SIZE):
            batch = chunks[start : start + EMBEDDING_BATCH_SIZE]
            embeddings = embedder.embed([chunk.text for chunk in batch])
            if len(embeddings) != len(batch):
                raise PdfRetrievalError("embedding count does not match PDF chunks")
            cursor.executemany(
                """
                    INSERT INTO app.pdf_chunks (
                        version_id, chunk_id, chunk_text, page, filename, embedding
                    ) VALUES (%s, %s, %s, %s, %s, %s::extensions.vector)
                    """,
                [
                    (
                        version_id,
                        chunk.id,
                        chunk.text,
                        chunk.page,
                        chunk.filename,
                        _vector_literal(embedding),
                    )
                    for chunk, embedding in zip(batch, embeddings, strict=True)
                ],
            )
        cursor.execute("UPDATE app.pdf_versions SET is_active = false WHERE is_active")
        cursor.execute("UPDATE app.pdf_versions SET is_active = true WHERE id = %s", (version_id,))
    print("Published a new PDF version to Supabase pgvector.")


if __name__ == "__main__":
    main()
