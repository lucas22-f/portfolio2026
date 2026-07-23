"""Domain-level evidence retrieval — pure functions for grounded chat."""

from __future__ import annotations

import re
from typing import Literal

from app.domain.content import ContentBundle, PortfolioRecord, normalize_content_text

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NON_ALNUM = re.compile(r"[^\w\sáéíóúüñÁÉÍÓÚÜÑ]+")
WHITESPACE_PATTERN = re.compile(r"\s+")
DEFAULT_UNSAFE_PATTERNS: frozenset[str] = frozenset({
    "inyección", "ignorar", "olvida", "olvide", "instrucciones",
    "ignora", "ignoren", "ignorá", "bias",
})
ALIAS_TITLE_WEIGHT = 2
CLAIM_TAG_WEIGHT = 1

Classification = Literal["allowed", "unsupported", "unsafe"]


# ---------------------------------------------------------------------------
# Pure functions
# ---------------------------------------------------------------------------


def normalize_query(text: str) -> str:
    """NFC + explicit whitespace + lowercase + strip punctuation.

    Keeps letters, numbers, spaces, and common Spanish chars (áéíóúüñ).
    """
    normalized = normalize_content_text(text)
    with_spaces = NON_ALNUM.sub(" ", normalized)
    lowered = with_spaces.lower()
    return WHITESPACE_PATTERN.sub(" ", lowered).strip()


def _tokenize(text: str) -> set[str]:
    """Split normalized text into whitespace-delimited tokens."""
    return set(text.split())


def _classify_unsafe(
    query_normalized: str,
    unsafe_patterns: frozenset[str] | None = None,
) -> bool:
    """Return True if any query token (word) matches an unsafe pattern."""
    patterns = unsafe_patterns if unsafe_patterns is not None else DEFAULT_UNSAFE_PATTERNS
    if not patterns:
        return False
    tokens = set(query_normalized.split())
    return bool(tokens & patterns)


def _score_record(
    query_tokens: set[str],
    record: PortfolioRecord,
) -> tuple[int, list[str], list[str]]:
    """Score a single record against query tokens.

    Returns (score, list_of_matched_claim_ids, list_of_matched_tokens).
    """
    score = 0
    matched_claim_ids: set[str] = set()
    matched_tokens: set[str] = set()

    # Build lookup fields — tokenize once
    alias_tokens: set[str] = set()
    for alias in record.aliases:
        alias_tokens |= _tokenize(normalize_query(alias))
    title_tokens = _tokenize(normalize_query(record.title))

    claim_tokens: set[str] = set()
    for claim in record.claims:
        claim_text_tokens = _tokenize(normalize_query(claim.text))
        if claim_text_tokens & query_tokens:
            matched_claim_ids.add(claim.claim_id)
        claim_tokens |= claim_text_tokens

    tag_tokens: set[str] = set()
    for tag in record.tags:
        tag_tokens |= _tokenize(normalize_query(tag))

    # Score each query token
    for token in query_tokens:
        if token in alias_tokens or token in title_tokens:
            score += ALIAS_TITLE_WEIGHT
            matched_tokens.add(token)
        elif token in claim_tokens or token in tag_tokens:
            score += CLAIM_TAG_WEIGHT
            matched_tokens.add(token)

    return score, sorted(matched_claim_ids), sorted(matched_tokens)


# ---------------------------------------------------------------------------
# Public result types
# ---------------------------------------------------------------------------


class ScoredResult:
    """A single evidence retrieval result with provenance."""

    def __init__(
        self,
        record_id: str,
        score: int,
        matched_claims: list[str],
        matched_tokens: list[str],
        provenance: list[str],
    ) -> None:
        self.record_id = record_id
        self.score = score
        self.matched_claims = matched_claims
        self.matched_tokens = matched_tokens
        self.provenance = provenance

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ScoredResult):
            return NotImplemented
        return (
            self.record_id == other.record_id
            and self.score == other.score
            and self.matched_claims == other.matched_claims
            and self.matched_tokens == other.matched_tokens
            and self.provenance == other.provenance
        )

    def __repr__(self) -> str:
        return (
            f"ScoredResult(record_id={self.record_id!r}, score={self.score}, "
            f"matched_claims={self.matched_claims!r})"
        )


class RetrievalOutcome:
    """The result of a retrieval classification pass."""

    def __init__(
        self,
        classification: Classification,
        results: list[ScoredResult],
        query_normalized: str,
        matched_tokens: list[str] | None = None,
    ) -> None:
        self.classification = classification
        self.results = results
        self.query_normalized = query_normalized
        self.matched_tokens = matched_tokens or []

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, RetrievalOutcome):
            return NotImplemented
        return (
            self.classification == other.classification
            and self.results == other.results
            and self.query_normalized == other.query_normalized
            and self.matched_tokens == other.matched_tokens
        )

    def __repr__(self) -> str:
        return (
            f"RetrievalOutcome(classification={self.classification!r}, "
            f"results={self.results!r})"
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def retrieve_evidence(
    query: str,
    bundle: ContentBundle,
    *,
    min_score: int = 1,
    top_k: int = 3,
    max_query_length: int = 500,
    unsafe_patterns: frozenset[str] | None = None,
) -> RetrievalOutcome:
    """Classify and retrieve evidence for a visitor query.

    Returns a RetrievalOutcome with classification and scored results.
    Classification order:
        1. unsafe — matches unsafe patterns
        2. allowed — at least one record meets the min_score threshold
        3. unsupported — no records meet the threshold
    """
    # Step 1: Normalize
    normalized = normalize_query(query)
    # Clip to max length
    if len(normalized) > max_query_length:
        normalized = normalized[:max_query_length]

    if _classify_unsafe(normalized, unsafe_patterns):
        return RetrievalOutcome(classification="unsafe", results=[], query_normalized=normalized)

    if not normalized:
        return RetrievalOutcome(
            classification="unsupported", results=[], query_normalized=normalized
        )

    # Step 4: Score records
    query_tokens = _tokenize(normalized)
    scored: list[ScoredResult] = []

    for record in bundle.portfolio.records:
        score, matched_claims, matched_tokens = _score_record(query_tokens, record)
        if score >= min_score:
            scored.append(ScoredResult(
                record_id=record.id,
                score=score,
                matched_claims=matched_claims,
                matched_tokens=matched_tokens,
                provenance=list(record.provenance),
            ))

    # Step 5: Stable sort — descending score, then ascending record ID
    scored.sort(key=lambda r: (-r.score, r.record_id))

    # Step 6: Top-k
    results = scored[:top_k]

    # Step 7: Collect all matched tokens
    all_matched: set[str] = set()
    for r in results:
        all_matched |= set(r.matched_tokens)

    classification: Classification = "allowed" if results else "unsupported"
    return RetrievalOutcome(
        classification=classification,
        results=results,
        query_normalized=normalized,
        matched_tokens=sorted(all_matched),
    )
