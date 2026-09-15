"""Small, dependency-free request safety classification for the PDF chat."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

_NON_ALNUM = re.compile(r"[^\w\sáéíóúüñÁÉÍÓÚÜÑ]+")
_WHITESPACE = re.compile(r"\s+")
DEFAULT_UNSAFE_PATTERNS: frozenset[str] = frozenset(
    {"inyección", "ignorar", "olvida", "olvide", "instrucciones", "ignora", "ignorá"}
)
Classification = Literal["allowed", "unsupported", "unsafe"]


def normalize_query(text: str) -> str:
    """Normalize user input before checking complete unsafe tokens."""
    normalized = unicodedata.normalize("NFC", text)
    return _WHITESPACE.sub(" ", _NON_ALNUM.sub(" ", normalized).lower()).strip()


@dataclass(frozen=True, slots=True)
class SafetyOutcome:
    classification: Classification
    query_normalized: str


def classify_safety(query: str, *, unsafe_patterns: frozenset[str] | None = None) -> SafetyOutcome:
    normalized = normalize_query(query)[:500]
    patterns = unsafe_patterns if unsafe_patterns is not None else DEFAULT_UNSAFE_PATTERNS
    classification: Classification = "unsafe" if set(normalized.split()) & patterns else "allowed"
    return SafetyOutcome(classification=classification, query_normalized=normalized)
