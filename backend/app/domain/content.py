from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

IDENTIFIER_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
SHA256_PATTERN = r"^[0-9a-f]{64}$"
WHITESPACE_PATTERN = re.compile(
    "[\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a"
    "\\u2028\\u2029\\u202f\\u205f\\u3000]+"
)


class ContentValidationError(ValueError):
    """Raised when reviewed portfolio content violates its shared contract."""


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def _unique(values: list[str], label: str) -> list[str]:
    if len(values) != len(set(values)):
        raise ValueError(f"{label} values must be unique")
    return values


class Claim(StrictModel):
    claim_id: str = Field(pattern=IDENTIFIER_PATTERN)
    text: str = Field(min_length=1)
    provenance_id: str = Field(pattern=IDENTIFIER_PATTERN)


class ProjectLink(StrictModel):
    label: str = Field(min_length=1)
    url: str = Field(pattern=r"^https://")


class ProjectDetails(StrictModel):
    summary: str = Field(min_length=1)
    links: list[ProjectLink] | None = Field(default=None, min_length=1)

    @field_validator("links", mode="before")
    @classmethod
    def reject_explicit_null_links(cls, value: object) -> object:
        if value is None:
            raise ValueError("links must be omitted instead of null")
        return value


class PortfolioRecord(StrictModel):
    id: str = Field(pattern=IDENTIFIER_PATTERN)
    kind: Literal["profile", "experience", "education", "skill", "project"]
    title: str = Field(min_length=1)
    claims: list[Claim] = Field(min_length=1)
    tags: list[str] = Field(min_length=1)
    aliases: list[str] = Field(min_length=1)
    project: ProjectDetails | None = None
    provenance: list[str] = Field(min_length=1)

    @field_validator("tags", "aliases", "provenance")
    @classmethod
    def validate_string_lists(cls, values: list[str], info: Any) -> list[str]:
        if any(not value for value in values):
            raise ValueError(f"{info.field_name} values must be non-empty")
        if info.field_name == "provenance" and any(
            re.fullmatch(IDENTIFIER_PATTERN, value) is None for value in values
        ):
            raise ValueError("provenance values must be identifiers")
        return _unique(values, info.field_name)

    @field_validator("project", mode="before")
    @classmethod
    def reject_explicit_null_project(cls, value: object) -> object:
        if value is None:
            raise ValueError("project must be omitted instead of null")
        return value


class PortfolioContent(StrictModel):
    schema_version: Literal["1.0.0"]
    content_version: str = Field(pattern=SHA256_PATTERN)
    locale: Literal["es"]
    records: list[PortfolioRecord] = Field(min_length=1)


class ReviewedSource(StrictModel):
    source_id: str = Field(pattern=IDENTIFIER_PATTERN)
    file_name: str = Field(min_length=1)
    source_sha256: str = Field(pattern=SHA256_PATTERN)
    source_text_sha256: str = Field(pattern=SHA256_PATTERN)
    page_count: int = Field(gt=0)


class ProvenanceLocator(StrictModel):
    provenance_id: str = Field(pattern=IDENTIFIER_PATTERN)
    source_id: str = Field(pattern=IDENTIFIER_PATTERN)
    source_sha256: str = Field(pattern=SHA256_PATTERN)
    page: int = Field(gt=0)
    normalized_start: int = Field(ge=0)
    normalized_end: int = Field(gt=0)
    excerpt_sha256: str = Field(pattern=SHA256_PATTERN)
    reviewed_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    reviewer: str = Field(min_length=1)


class ReviewedManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    content_version: str = Field(pattern=SHA256_PATTERN)
    sources: list[ReviewedSource] = Field(min_length=1)
    entries: list[ProvenanceLocator] = Field(min_length=1)


class SourcePage(StrictModel):
    page: int = Field(gt=0)
    normalized_text: str = Field(min_length=1)
    normalized_sha256: str = Field(pattern=SHA256_PATTERN)


class SourceText(StrictModel):
    schema_version: Literal["1.0.0"]
    normalization: Literal["unicode-nfc-explicit-whitespace-utf8-offsets-v1"]
    source_id: str = Field(pattern=IDENTIFIER_PATTERN)
    file_name: str = Field(min_length=1)
    source_sha256: str = Field(pattern=SHA256_PATTERN)
    pages: list[SourcePage] = Field(min_length=1)


class ContentBundle(StrictModel):
    portfolio: PortfolioContent
    manifest: ReviewedManifest
    source_text: SourceText


def normalize_content_text(value: str) -> str:
    """Apply NFC and the contract's explicit Unicode whitespace set."""

    return WHITESPACE_PATTERN.sub(" ", unicodedata.normalize("NFC", value)).strip(" ")


def normalized_sha256(value: str) -> str:
    return hashlib.sha256(normalize_content_text(value).encode()).hexdigest()


def verify_provenance_locator(
    page_text: str,
    *,
    normalized_start: int,
    normalized_end: int,
    excerpt_sha256: str,
) -> bool:
    normalized_bytes = normalize_content_text(page_text).encode()
    if not (0 <= normalized_start < normalized_end <= len(normalized_bytes)):
        return False
    try:
        normalized_bytes[normalized_start:normalized_end].decode("utf-8")
    except UnicodeDecodeError:
        return False
    return (
        hashlib.sha256(normalized_bytes[normalized_start:normalized_end]).hexdigest()
        == excerpt_sha256
    )


def _model_contract_value(model: BaseModel) -> dict[str, object]:
    return model.model_dump(mode="json", exclude={"content_version"}, exclude_none=True)


def compute_content_version(
    portfolio: PortfolioContent | dict[str, object],
    manifest: ReviewedManifest | dict[str, object],
) -> str:
    portfolio_data = (
        _model_contract_value(portfolio)
        if isinstance(portfolio, PortfolioContent)
        else {key: value for key, value in portfolio.items() if key != "content_version"}
    )
    manifest_data = (
        _model_contract_value(manifest)
        if isinstance(manifest, ReviewedManifest)
        else {key: value for key, value in manifest.items() if key != "content_version"}
    )
    payload = json.dumps(
        {"manifest": manifest_data, "portfolio": portfolio_data},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def _canonical_source_hash(source_text: SourceText) -> str:
    payload = json.dumps(
        source_text.model_dump(mode="json"),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def validate_content_bundle(
    portfolio: PortfolioContent,
    manifest: ReviewedManifest,
    source_text: SourceText,
) -> ContentBundle:
    sources = {source.source_id: source for source in manifest.sources}
    entries = {entry.provenance_id: entry for entry in manifest.entries}
    pages = {page.page: page for page in source_text.pages}
    if len(sources) != len(manifest.sources) or len(entries) != len(manifest.entries):
        raise ContentValidationError("Source and provenance identifiers must be unique.")
    if len(manifest.sources) != 1:
        raise ContentValidationError("The bundle requires exactly one manifest source.")
    if len(pages) != len(source_text.pages):
        raise ContentValidationError("Source page identifiers must be unique.")

    source = manifest.sources[0]
    if source.source_id != source_text.source_id or source.file_name != source_text.file_name:
        raise ContentValidationError("Checked-in source text does not match the manifest source.")
    if source.source_sha256 != source_text.source_sha256:
        raise ContentValidationError("Checked-in source hash does not match the manifest.")
    if source.source_text_sha256 != _canonical_source_hash(source_text):
        raise ContentValidationError("Checked-in source text hash does not match the manifest.")
    if source.page_count != len(pages):
        raise ContentValidationError(
            "Checked-in source text page count does not match the manifest."
        )
    for page in source_text.pages:
        if normalize_content_text(page.normalized_text) != page.normalized_text:
            raise ContentValidationError(f"Source text page {page.page} is not normalized.")
        if normalized_sha256(page.normalized_text) != page.normalized_sha256:
            raise ContentValidationError(f"Source text page {page.page} hash mismatch.")

    for entry in manifest.entries:
        if entry.source_id != source_text.source_id:
            raise ContentValidationError(
                f"Provenance source mismatch with checked source text: {entry.provenance_id}"
            )
        entry_source = sources.get(entry.source_id)
        locator_page = pages.get(entry.page)
        if entry_source is None or locator_page is None:
            raise ContentValidationError(f"Unknown source locator: {entry.provenance_id}")
        if entry.source_sha256 != entry_source.source_sha256:
            raise ContentValidationError(f"Source hash mismatch: {entry.provenance_id}")
        if not verify_provenance_locator(
            locator_page.normalized_text,
            normalized_start=entry.normalized_start,
            normalized_end=entry.normalized_end,
            excerpt_sha256=entry.excerpt_sha256,
        ):
            raise ContentValidationError(f"Invalid provenance locator: {entry.provenance_id}")

    record_ids: set[str] = set()
    claim_ids: set[str] = set()
    for record in portfolio.records:
        if record.id in record_ids:
            raise ContentValidationError(f"Duplicate record identifier: {record.id}")
        record_ids.add(record.id)
        if (record.kind == "project") != (record.project is not None):
            raise ContentValidationError(f"Project details mismatch: {record.id}")
        for claim in record.claims:
            if claim.claim_id in claim_ids:
                raise ContentValidationError(f"Duplicate claim identifier: {claim.claim_id}")
            claim_ids.add(claim.claim_id)
            if claim.provenance_id not in entries:
                raise ContentValidationError(f"Unknown provenance reference: {claim.provenance_id}")
        if set(record.provenance) != {claim.provenance_id for claim in record.claims}:
            raise ContentValidationError(f"Record provenance does not match claims: {record.id}")

    if portfolio.content_version != manifest.content_version:
        raise ContentValidationError("Portfolio and manifest content versions differ.")
    if portfolio.content_version != compute_content_version(portfolio, manifest):
        raise ContentValidationError("Stored content version does not match reviewed content.")
    return ContentBundle(portfolio=portfolio, manifest=manifest, source_text=source_text)


def load_content_bundle_from_values(
    portfolio_value: dict[str, object],
    manifest_value: dict[str, object],
    source_text_path: Path,
) -> ContentBundle:
    try:
        portfolio = PortfolioContent.model_validate(portfolio_value)
        manifest = ReviewedManifest.model_validate(manifest_value)
        source_text = SourceText.model_validate_json(source_text_path.read_text(encoding="utf-8"))
    except (OSError, ValidationError, json.JSONDecodeError) as error:
        raise ContentValidationError(f"Invalid content files: {error}") from error
    return validate_content_bundle(portfolio, manifest, source_text)


def load_content_bundle(content_root: Path) -> ContentBundle:
    try:
        portfolio_value = json.loads((content_root / "portfolio.json").read_text(encoding="utf-8"))
        manifest_value = json.loads(
            (content_root / "reviewed-manifest.json").read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError) as error:
        raise ContentValidationError(f"Invalid content files: {error}") from error
    return load_content_bundle_from_values(
        portfolio_value, manifest_value, content_root / "cv-source.json"
    )
