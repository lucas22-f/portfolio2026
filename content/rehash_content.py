"""Regenerate the checked-in CV text snapshot, provenance hashes, and versions."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

from pypdf import PdfReader

WHITESPACE = re.compile(
    "[\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+"
)


def normalize(value: str) -> str:
    return WHITESPACE.sub(" ", unicodedata.normalize("NFC", value)).strip(" ")


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--output", default=Path(__file__).parent / "v1", type=Path)
    parser.add_argument("--verified-at", required=True)
    args = parser.parse_args()

    output = args.output.resolve()
    portfolio = json.loads((output / "portfolio.json").read_text(encoding="utf-8"))
    source_bytes = args.pdf.read_bytes()
    pages = [normalize(page.extract_text() or "") for page in PdfReader(str(args.pdf)).pages]
    source = {
        "schema_version": "1.0.0",
        "normalization": "unicode-nfc-explicit-whitespace-utf8-offsets-v1",
        "source_id": "cv-lucas-figueroa",
        "file_name": args.pdf.name,
        "source_sha256": digest(source_bytes),
        "pages": [
            {
                "page": index,
                "normalized_text": text,
                "normalized_sha256": digest(text.encode()),
            }
            for index, text in enumerate(pages, 1)
        ],
    }
    source_text_sha256 = digest(canonical(source))
    manifest = {
        "schema_version": "1.0.0",
        "content_version": "0" * 64,
        "sources": [
            {
                "source_id": source["source_id"],
                "file_name": source["file_name"],
                "source_sha256": source["source_sha256"],
                "source_text_sha256": source_text_sha256,
                "page_count": len(pages),
            }
        ],
        "entries": [
            {
                "provenance_id": f"cv-page-{index}",
                "source_id": source["source_id"],
                "source_sha256": source["source_sha256"],
                "page": index,
                "normalized_start": 0,
                "normalized_end": len(text.encode()),
                "excerpt_sha256": digest(text.encode()),
                "reviewed_at": args.verified_at,
                "reviewer": "automated-source-verification:pypdf",
            }
            for index, text in enumerate(pages, 1)
        ],
    }
    portfolio["content_version"] = "0" * 64
    payload = {
        "manifest": {key: value for key, value in manifest.items() if key != "content_version"},
        "portfolio": {key: value for key, value in portfolio.items() if key != "content_version"},
    }
    version = digest(canonical(payload))
    portfolio["content_version"] = manifest["content_version"] = version

    normalization_inputs = [
        "  Cafe\u0301\r\n  con\tIA  ",
        "Agente\u00a0\U0001f916\u2003RAG\u2028Python",
        "A\u0085B\u202fC\u3000D",
    ]
    vectors = {
        "expected_content_version": version,
        "normalization_vectors": [
            {
                "input": value,
                "normalized": normalize(value),
                "sha256": digest(normalize(value).encode()),
                "utf8_length": len(normalize(value).encode()),
            }
            for value in normalization_inputs
        ],
        "locator_vectors": [
            {
                "page_text": "Alpha Beta Gamma",
                "normalized_start": start,
                "normalized_end": end,
                "excerpt_sha256": digest(b"Alpha Beta Gamma"[start:end]),
            }
            for start, end in [(5, 10), (6, 11)]
        ],
        "negative_vectors": [
            {
                "document": "portfolio",
                "path": "records.0.extra",
                "value": True,
                "expected_error": "additional property|Extra inputs",
            },
            {
                "document": "portfolio",
                "path": "records.0.id",
                "value": "Bad ID",
                "expected_error": "record.id|String should match pattern",
            },
            {
                "document": "portfolio",
                "path": "records.0.tags",
                "value": [],
                "expected_error": "record.tags|List should have at least 1 item",
            },
            {
                "document": "portfolio",
                "path": "records.15.project.links",
                "value": None,
                "expected_error": "record.project.links|links",
            },
            {
                "document": "manifest",
                "path": "sources.0.file_name",
                "value": "",
                "expected_error": "source.file_name|String should have at least 1 character",
            },
            {
                "document": "manifest",
                "path": "entries.0.reviewer",
                "value": "",
                "expected_error": "entry.reviewer|String should have at least 1 character",
            },
            {
                "document": "portfolio",
                "path": "records.1.id",
                "value": "lucas-figueroa",
                "expected_error": "Duplicate record|Invalid portfolio record",
            },
            {
                "document": "portfolio",
                "path": "records.1.claims.0.claim_id",
                "value": "profile-role",
                "expected_error": "Duplicate claim",
            },
            {
                "document": "manifest",
                "path": "sources.1",
                "value": {**manifest["sources"][0], "source_id": "unused-source"},
                "expected_error": "exactly one manifest source",
            },
        ],
    }
    write_json(output / "cv-source.json", source)
    write_json(output / "reviewed-manifest.json", manifest)
    write_json(output / "portfolio.json", portfolio)
    write_json(output / "content-contract-vectors.json", vectors)
    print(version)


if __name__ == "__main__":
    main()
