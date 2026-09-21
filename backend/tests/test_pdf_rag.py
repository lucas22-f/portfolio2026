from __future__ import annotations

from pathlib import Path

import pytest

from app.infrastructure.pdf_rag import PdfRetrievalError, SupabasePdfRetriever, extract_pdf_chunks


class FakeEmbedder:
    def embed(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * 1536 for _ in texts]


class FakeCursor:
    def __init__(self, rows: list[tuple[object, ...]]) -> None:
        self.rows = rows
        self.queries: list[tuple[str, tuple[object, ...]]] = []

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, query: str, parameters: tuple[object, ...]) -> None:
        self.queries.append((query, parameters))

    def fetchone(self) -> tuple[object, ...] | None:
        return ("active-sha",)

    def fetchall(self) -> list[tuple[object, ...]]:
        return self.rows


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return self._cursor


def test_extract_pdf_chunks_preserves_filename_and_one_based_page_metadata() -> None:
    pdf = Path(__file__).resolve().parents[1] / "app" / "docs" / "CV_Lucas_Figueroa_1.pdf"

    chunks = extract_pdf_chunks(pdf, chunk_size=200, overlap=20)

    assert chunks
    assert all(chunk.filename == pdf.name and chunk.page >= 1 for chunk in chunks)
    assert all(len(chunk.text) <= 200 for chunk in chunks)


def test_supabase_retriever_queries_rpc_and_returns_page_citations() -> None:
    cursor = FakeCursor([("chunk-1", "Python experience", 2, "CV.pdf", 0.1)])
    retriever = SupabasePdfRetriever(
        "configured-test-connection",
        FakeEmbedder(),
        connect=lambda *args, **kwargs: FakeConnection(cursor),
    )

    results = retriever.search("Python")

    assert retriever.content_version == "active-sha"
    assert results[0].chunk.filename == "CV.pdf"
    assert results[0].chunk.page == 2
    assert results[0].distance == 0.1
    assert "public.search_portfolio_pdf" in cursor.queries[-1][0]
    assert cursor.queries[-1][1][2:] == ("text-embedding-3-small", 1536)


def test_supabase_retriever_rejects_wrong_embedding_dimensions() -> None:
    class WrongDimensionsEmbedder:
        def embed(self, texts: list[str]) -> list[list[float]]:
            return [[0.0] for _ in texts]

    retriever = SupabasePdfRetriever(
        "configured-test-connection",
        WrongDimensionsEmbedder(),
        connect=lambda *args, **kwargs: FakeConnection(FakeCursor([])),
    )

    with pytest.raises(PdfRetrievalError, match="dimensions"):
        retriever.search("Python")
