"""PDF extraction, OpenAI embeddings, and Supabase pgvector retrieval."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import fitz  # type: ignore[import-untyped]
import psycopg


class PdfRetrievalError(RuntimeError):
    """Raised when the local index or embeddings cannot be used safely."""


@dataclass(frozen=True, slots=True)
class PdfChunk:
    id: str
    text: str
    page: int
    filename: str


@dataclass(frozen=True, slots=True)
class PdfCitation:
    filename: str
    page: int


@dataclass(frozen=True, slots=True)
class PdfSearchResult:
    chunk: PdfChunk
    distance: float


class Embedder(Protocol):
    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class PdfRetriever(Protocol):
    content_version: str

    def search(self, query: str, *, top_k: int = 3) -> list[PdfSearchResult]: ...


def extract_pdf_chunks(
    pdf_path: Path, *, chunk_size: int = 900, overlap: int = 150
) -> list[PdfChunk]:
    """Extract bounded, deterministic page-local chunks without modifying the source PDF."""
    if chunk_size <= 0 or overlap < 0 or overlap >= chunk_size:
        raise ValueError("chunk_size and overlap must define forward progress")
    try:
        document = fitz.open(pdf_path)
    except (fitz.FileDataError, OSError) as error:
        raise PdfRetrievalError("PDF extraction is unavailable") from error
    chunks: list[PdfChunk] = []
    try:
        for page_number, page in enumerate(document, start=1):
            text = " ".join(page.get_text("text").split())
            for offset in range(0, len(text), chunk_size - overlap):
                chunk_text = text[offset : offset + chunk_size].strip()
                if chunk_text:
                    digest = hashlib.sha256(
                        f"{pdf_path.name}:{page_number}:{offset}:{chunk_text}".encode()
                    ).hexdigest()
                    chunks.append(PdfChunk(digest, chunk_text, page_number, pdf_path.name))
    finally:
        document.close()
    if not chunks:
        raise PdfRetrievalError("PDF contains no extractable text")
    return chunks


class OpenAIEmbedder:
    _URL = "https://api.openai.com/v1/embeddings"

    def __init__(
        self, api_key: str, *, model: str = "text-embedding-3-small", timeout_seconds: float = 20.0
    ) -> None:
        if not api_key.strip() or not model.strip() or timeout_seconds <= 0:
            raise ValueError("embedding configuration is invalid")
        self._api_key, self._model, self._timeout_seconds = api_key, model, timeout_seconds

    @property
    def model(self) -> str:
        return self._model

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        request = Request(
            self._URL,
            data=json.dumps(
                {"model": self._model, "input": list(texts)}, ensure_ascii=False
            ).encode(),
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:  # noqa: S310
                payload = json.loads(response.read())
        except (HTTPError, URLError, OSError, json.JSONDecodeError) as error:
            raise PdfRetrievalError("embeddings are unavailable") from error
        raw_data = payload.get("data") if isinstance(payload, Mapping) else None
        if not isinstance(raw_data, list) or len(raw_data) != len(texts):
            raise PdfRetrievalError("embeddings response is invalid")
        vectors: list[list[float]] = []
        for item in raw_data:
            vector = item.get("embedding") if isinstance(item, Mapping) else None
            if not isinstance(vector, list) or not all(
                isinstance(value, (int, float)) for value in vector
            ):
                raise PdfRetrievalError("embeddings response is invalid")
            vectors.append([float(value) for value in vector])
        return vectors


class SupabasePdfRetriever:
    """Query the active, manually seeded Supabase PDF version without mutating it."""

    _DIMENSIONS = 1536

    def __init__(
        self,
        database_url: str,
        embedder: Embedder,
        *,
        embedding_model: str = "text-embedding-3-small",
        max_relevant_distance: float = 1.25,
        connect: Callable[..., Any] = psycopg.connect,
    ) -> None:
        if (
            not database_url.strip()
            or embedding_model != "text-embedding-3-small"
            or max_relevant_distance <= 0
        ):
            raise ValueError("Supabase PDF retrieval configuration is invalid")
        self._database_url = database_url
        self._embedder = embedder
        self._embedding_model = embedding_model
        self._max_relevant_distance = max_relevant_distance
        self._connect = connect
        self.content_version = self._load_active_version()

    def _load_active_version(self) -> str:
        try:
            with (
                self._connect(self._database_url, connect_timeout=5) as connection,
                connection.cursor() as cursor,
            ):
                cursor.execute(
                    """
                    SELECT source_sha256
                    FROM app.pdf_versions
                    WHERE is_active
                      AND embedding_model = %s
                      AND embedding_dimensions = %s
                    """,
                    (self._embedding_model, self._DIMENSIONS),
                )
                row = cursor.fetchone()
        except Exception as error:
            raise PdfRetrievalError("Supabase PDF retrieval is unavailable") from error
        if not row or not isinstance(row[0], str):
            raise PdfRetrievalError("no compatible seeded PDF version is active")
        return row[0]

    @staticmethod
    def _vector_literal(vector: Sequence[float]) -> str:
        if len(vector) != SupabasePdfRetriever._DIMENSIONS or not all(
            isinstance(value, (int, float)) for value in vector
        ):
            raise PdfRetrievalError("embedding dimensions do not match the seeded PDF index")
        return "[" + ",".join(str(float(value)) for value in vector) + "]"

    def search(self, query: str, *, top_k: int = 3) -> list[PdfSearchResult]:
        if not query.strip() or top_k <= 0:
            return []
        embeddings = self._embedder.embed([query])
        if len(embeddings) != 1:
            raise PdfRetrievalError("embeddings response is invalid")
        vector = self._vector_literal(embeddings[0])
        try:
            with (
                self._connect(self._database_url, connect_timeout=5) as connection,
                connection.cursor() as cursor,
            ):
                cursor.execute(
                    """
                    SELECT chunk_id, chunk_text, page, filename, distance
                    FROM public.search_portfolio_pdf(
                        %s::extensions.vector, %s, %s, %s
                    )
                    """,
                    (vector, top_k, self._embedding_model, self._DIMENSIONS),
                )
                rows = cursor.fetchall()
        except PdfRetrievalError:
            raise
        except Exception as error:
            raise PdfRetrievalError("Supabase PDF retrieval is unavailable") from error

        results: list[PdfSearchResult] = []
        for row in rows:
            if len(row) != 5:
                continue
            chunk_id, text, page, filename, distance = row
            if (
                isinstance(chunk_id, str)
                and isinstance(text, str)
                and isinstance(page, int)
                and isinstance(filename, str)
                and isinstance(distance, (int, float))
                and float(distance) <= self._max_relevant_distance
            ):
                results.append(
                    PdfSearchResult(PdfChunk(chunk_id, text, page, filename), float(distance))
                )
        return results
