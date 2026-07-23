import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from app.domain.content import (
    ContentValidationError,
    compute_content_version,
    load_content_bundle,
    load_content_bundle_from_values,
    normalize_content_text,
    verify_provenance_locator,
)

CONTENT_ROOT = Path(__file__).parents[2] / "content" / "v1"
VECTORS_PATH = CONTENT_ROOT / "content-contract-vectors.json"


def test_normalization_and_locator_hash_use_the_approved_algorithm() -> None:
    page = "  Cafe\u0301\r\n  con\tIA  "
    normalized = "Caf\u00e9 con IA"
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    assert normalize_content_text(page) == normalized
    assert verify_provenance_locator(
        page,
        normalized_start=0,
        normalized_end=len(normalized.encode("utf-8")),
        excerpt_sha256=digest,
    )
    assert not verify_provenance_locator(
        page,
        normalized_start=0,
        normalized_end=4,
        excerpt_sha256=digest,
    )


def test_reviewed_content_files_share_a_recomputed_version() -> None:
    bundle = load_content_bundle(CONTENT_ROOT)

    assert bundle.portfolio.content_version == bundle.manifest.content_version
    assert bundle.portfolio.content_version == compute_content_version(
        bundle.portfolio, bundle.manifest
    )
    assert {record.kind for record in bundle.portfolio.records} == {
        "profile",
        "experience",
        "education",
        "skill",
        "project",
    }
    assert all(record.provenance for record in bundle.portfolio.records)
    assert all(
        claim.provenance_id for record in bundle.portfolio.records for claim in record.claims
    )
    assert "?" not in json.dumps(bundle.portfolio.model_dump(), ensure_ascii=False)


def test_missing_optional_project_links_remain_missing() -> None:
    bundle = load_content_bundle(CONTENT_ROOT)
    project_without_links = next(
        record
        for record in bundle.portfolio.records
        if record.kind == "project" and record.project and record.project.links is None
    )

    serialized = project_without_links.model_dump(exclude_none=True)

    assert "links" not in serialized["project"]


def test_unknown_provenance_is_rejected(tmp_path: Path) -> None:
    portfolio = json.loads((CONTENT_ROOT / "portfolio.json").read_text(encoding="utf-8"))
    manifest = json.loads((CONTENT_ROOT / "reviewed-manifest.json").read_text(encoding="utf-8"))
    portfolio["records"][0]["claims"][0]["provenance_id"] = "missing-reference"
    (tmp_path / "portfolio.json").write_text(json.dumps(portfolio), encoding="utf-8")
    (tmp_path / "reviewed-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (tmp_path / "cv-source.json").write_bytes((CONTENT_ROOT / "cv-source.json").read_bytes())

    with pytest.raises(ContentValidationError, match="missing-reference"):
        load_content_bundle(tmp_path)


def test_missing_required_record_field_is_rejected(tmp_path: Path) -> None:
    portfolio = json.loads((CONTENT_ROOT / "portfolio.json").read_text(encoding="utf-8"))
    manifest = json.loads((CONTENT_ROOT / "reviewed-manifest.json").read_text(encoding="utf-8"))
    del portfolio["records"][0]["title"]
    (tmp_path / "portfolio.json").write_text(json.dumps(portfolio), encoding="utf-8")
    (tmp_path / "reviewed-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (tmp_path / "cv-source.json").write_bytes((CONTENT_ROOT / "cv-source.json").read_bytes())

    with pytest.raises(ContentValidationError, match="title"):
        load_content_bundle(tmp_path)


def test_real_bundle_rehashes_checked_in_source_text(tmp_path: Path) -> None:
    source_path = CONTENT_ROOT / "cv-source.json"
    assert source_path.exists()
    assert load_content_bundle(CONTENT_ROOT).portfolio.content_version

    for path in CONTENT_ROOT.glob("*.json"):
        (tmp_path / path.name).write_bytes(path.read_bytes())
    source = json.loads((tmp_path / "cv-source.json").read_text(encoding="utf-8"))
    source["pages"][0]["normalized_text"] += " alterado"
    (tmp_path / "cv-source.json").write_text(
        json.dumps(source, ensure_ascii=False), encoding="utf-8"
    )

    with pytest.raises(ContentValidationError, match="source text|locator|hash"):
        load_content_bundle(tmp_path)


def _set_path(document: dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    cursor: Any = document
    for part in parts[:-1]:
        cursor = cursor[int(part)] if isinstance(cursor, list) else cursor[part]
    final = parts[-1]
    if isinstance(cursor, list):
        index = int(final)
        if index == len(cursor):
            cursor.append(value)
        else:
            cursor[index] = value
    else:
        cursor[final] = value


def test_shared_normalization_and_negative_vectors() -> None:
    vectors = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
    for vector in vectors["normalization_vectors"]:
        assert normalize_content_text(vector["input"]) == vector["normalized"]
        assert hashlib.sha256(vector["normalized"].encode("utf-8")).hexdigest() == vector["sha256"]
        assert len(vector["normalized"].encode("utf-8")) == vector["utf8_length"]
    for vector in vectors["locator_vectors"]:
        assert verify_provenance_locator(
            vector["page_text"],
            normalized_start=vector["normalized_start"],
            normalized_end=vector["normalized_end"],
            excerpt_sha256=vector["excerpt_sha256"],
        )

    original_portfolio = json.loads((CONTENT_ROOT / "portfolio.json").read_text(encoding="utf-8"))
    original_manifest = json.loads(
        (CONTENT_ROOT / "reviewed-manifest.json").read_text(encoding="utf-8")
    )
    for vector in vectors["negative_vectors"]:
        portfolio = json.loads(json.dumps(original_portfolio))
        manifest = json.loads(json.dumps(original_manifest))
        target = portfolio if vector["document"] == "portfolio" else manifest
        _set_path(target, vector["path"], vector["value"])
        version = compute_content_version(portfolio, manifest)
        portfolio["content_version"] = manifest["content_version"] = version
        with pytest.raises(ContentValidationError, match=vector["expected_error"]):
            load_content_bundle_from_values(portfolio, manifest, CONTENT_ROOT / "cv-source.json")


def test_locator_cannot_switch_to_another_manifest_source() -> None:
    portfolio = json.loads((CONTENT_ROOT / "portfolio.json").read_text(encoding="utf-8"))
    manifest = json.loads((CONTENT_ROOT / "reviewed-manifest.json").read_text(encoding="utf-8"))
    manifest["sources"][0]["source_id"] = "other-source"
    manifest["entries"][0]["source_id"] = "other-source"
    version = compute_content_version(portfolio, manifest)
    portfolio["content_version"] = manifest["content_version"] = version

    with pytest.raises(ContentValidationError, match="source text.*manifest|source mismatch"):
        load_content_bundle_from_values(portfolio, manifest, CONTENT_ROOT / "cv-source.json")


def test_unused_second_manifest_source_is_rejected() -> None:
    portfolio = json.loads((CONTENT_ROOT / "portfolio.json").read_text(encoding="utf-8"))
    manifest = json.loads((CONTENT_ROOT / "reviewed-manifest.json").read_text(encoding="utf-8"))
    manifest["sources"].append({**manifest["sources"][0], "source_id": "unused-source"})
    version = compute_content_version(portfolio, manifest)
    portfolio["content_version"] = manifest["content_version"] = version

    with pytest.raises(ContentValidationError, match="exactly one manifest source"):
        load_content_bundle_from_values(portfolio, manifest, CONTENT_ROOT / "cv-source.json")


def test_empty_project_links_are_rejected() -> None:
    portfolio = json.loads((CONTENT_ROOT / "portfolio.json").read_text(encoding="utf-8"))
    manifest = json.loads((CONTENT_ROOT / "reviewed-manifest.json").read_text(encoding="utf-8"))
    portfolio["records"][15]["project"]["links"] = []
    version = compute_content_version(portfolio, manifest)
    portfolio["content_version"] = manifest["content_version"] = version

    with pytest.raises(ContentValidationError, match="links"):
        load_content_bundle_from_values(portfolio, manifest, CONTENT_ROOT / "cv-source.json")


@pytest.mark.parametrize("value", ["2", True])
def test_manifest_integers_are_strict(value: object) -> None:
    portfolio = json.loads((CONTENT_ROOT / "portfolio.json").read_text(encoding="utf-8"))
    manifest = json.loads((CONTENT_ROOT / "reviewed-manifest.json").read_text(encoding="utf-8"))
    manifest["sources"][0]["page_count"] = value
    version = compute_content_version(portfolio, manifest)
    portfolio["content_version"] = manifest["content_version"] = version

    with pytest.raises(ContentValidationError, match="page_count"):
        load_content_bundle_from_values(portfolio, manifest, CONTENT_ROOT / "cv-source.json")


def test_schema_declares_layered_semantic_constraints() -> None:
    schema = json.loads((CONTENT_ROOT / "portfolio.schema.json").read_text(encoding="utf-8"))

    assert schema["x-semantic-constraints"] == {
        "uniqueRecordIds": True,
        "globallyUniqueClaimIds": True,
        "recordProvenanceMatchesClaims": True,
    }


def test_rehash_generator_requires_an_explicit_review_date() -> None:
    generator = (CONTENT_ROOT.parent / "rehash_content.py").read_text(encoding="utf-8")

    assert "default=date.today" not in generator
    assert 'parser.add_argument("--verified-at", required=True)' in generator
