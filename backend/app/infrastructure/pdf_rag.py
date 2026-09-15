"""Minimal persisted PDF retrieval: PyMuPDF chunks, OpenAI embeddings and Chroma."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import chromadb
import fitz  # type: ignore[import-untyped]


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


class ChromaPdfRetriever:
    """Initialize one persisted collection; query it without rebuilding it."""

    def __init__(
        self,
        pdf_path: Path,
        persist_directory: Path,
        embedder: Embedder,
        *,
        collection_name: str = "portfolio_pdf",
        chunk_size: int = 900,
        chunk_overlap: int = 150,
        max_relevant_distance: float = 1.25,
    ) -> None:
        self._pdf_path, self._embedder, self._max_relevant_distance = (
            pdf_path,
            embedder,
            max_relevant_distance,
        )
        self.content_version = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
        persist_directory.mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(path=str(persist_directory))
        try:
            self._collection = self._client.get_collection(name=collection_name)
        except chromadb.errors.NotFoundError:
            self._collection = self._client.create_collection(
                name=collection_name, metadata={"hnsw:space": "cosine"}
            )
        current_version = (
            self._collection.metadata.get("pdf_sha256") if self._collection.metadata else None
        )
        if current_version != self.content_version:
            self._rebuild(chunk_size, chunk_overlap)

    def _rebuild(self, chunk_size: int, chunk_overlap: int) -> None:
        existing = self._collection.get(include=[])
        ids = existing.get("ids", [])
        if ids:
            self._collection.delete(ids=ids)
        chunks = extract_pdf_chunks(self._pdf_path, chunk_size=chunk_size, overlap=chunk_overlap)
        embeddings = self._embedder.embed([chunk.text for chunk in chunks])
        if len(embeddings) != len(chunks):
            raise PdfRetrievalError("embedding count does not match PDF chunks")
        self._collection.add(
            ids=[chunk.id for chunk in chunks],
            documents=[chunk.text for chunk in chunks],
            embeddings=cast(Any, embeddings),
            metadatas=[{"page": chunk.page, "filename": chunk.filename} for chunk in chunks],
        )
        self._collection.modify(metadata={"pdf_sha256": self.content_version})

    def search(self, query: str, *, top_k: int = 3) -> list[PdfSearchResult]:
        if not query.strip() or top_k <= 0:
            return []
        vector = self._embedder.embed([query])[0]
        response = self._collection.query(
            query_embeddings=cast(Any, [vector]),
            n_results=top_k,
            include=["documents", "metadatas", "distances"],
        )
        documents = (response.get("documents") or [[]])[0]
        metadatas = (response.get("metadatas") or [[]])[0]
        ids = (response.get("ids") or [[]])[0]
        distances = (response.get("distances") or [[]])[0]
        results: list[PdfSearchResult] = []
        for chunk_id, document, metadata, distance in zip(
            ids, documents, metadatas, distances, strict=True
        ):
            if (
                not isinstance(document, str)
                or not isinstance(metadata, Mapping)
                or not isinstance(distance, (int, float))
            ):
                continue
            page, filename = metadata.get("page"), metadata.get("filename")
            if (
                isinstance(chunk_id, str)
                and isinstance(page, int)
                and isinstance(filename, str)
                and float(distance) <= self._max_relevant_distance
            ):
                results.append(
                    PdfSearchResult(PdfChunk(chunk_id, document, page, filename), float(distance))
                )
        return results
