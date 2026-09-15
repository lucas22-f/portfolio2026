from pathlib import Path

from app.infrastructure.pdf_rag import ChromaPdfRetriever, extract_pdf_chunks


class FakeEmbedder:
    def embed(self, texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0] if "Python" in text else [0.0, 1.0] for text in texts]


def test_extract_pdf_chunks_preserves_filename_and_one_based_page_metadata() -> None:
    pdf = Path(__file__).resolve().parents[1] / "app" / "docs" / "CV_Lucas_Figueroa_1.pdf"

    chunks = extract_pdf_chunks(pdf, chunk_size=200, overlap=20)

    assert chunks
    assert all(chunk.filename == pdf.name and chunk.page >= 1 for chunk in chunks)
    assert all(len(chunk.text) <= 200 for chunk in chunks)


def test_chroma_index_is_reused_and_returns_page_citations(tmp_path: Path) -> None:
    pdf = Path(__file__).resolve().parents[1] / "app" / "docs" / "CV_Lucas_Figueroa_1.pdf"
    index = tmp_path / "chroma"

    first = ChromaPdfRetriever(pdf, index, FakeEmbedder(), max_relevant_distance=2.0)
    results = first.search("Python")
    second = ChromaPdfRetriever(pdf, index, FakeEmbedder(), max_relevant_distance=2.0)

    assert results
    assert all(result.chunk.filename == pdf.name and result.chunk.page >= 1 for result in results)
    assert second.content_version == first.content_version
