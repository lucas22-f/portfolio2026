"""Strict contact contracts and bounded, non-persistent submission protection."""

from __future__ import annotations

import hashlib
import hmac
import re
import threading
import time
import unicodedata
from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

CONTACT_FORM_VERSION: Literal["1"] = "1"
CONTACT_SUBMISSION_VERSION: Literal["1"] = "1"
CONTACT_FIELDS = ("name", "email", "company", "message")
CONTACT_INTENTS = ("employment", "interview", "recruiting")
NAME_MAX_LENGTH = 80
EMAIL_MAX_LENGTH = 254
COMPANY_MAX_LENGTH = 120
MESSAGE_MAX_LENGTH = 2_000
MAX_CONTACT_BODY_BYTES = 8 * 1024

ContactIntent = Literal["employment", "interview", "recruiting"]
ContactOutcome = Literal[
    "accepted",
    "duplicate_accepted",
    "duplicate_processing",
    "delivery_uncertain",
    "validation_error",
    "unsupported_version",
    "idempotency_conflict",
    "throttled",
    "delivery_unavailable",
    "delivery_retryable",
    "delivery_failed",
]

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_REFUSALS = (
    "no me contacten",
    "no me contactes",
    "no quiero contacto",
    "no quiero contactarme",
    "no quiero contactar",
    "do not contact",
    "don't contact",
    "not interested",
)
_INTENT_PHRASES: tuple[tuple[ContactIntent, tuple[str, ...]], ...] = (
    ("interview", ("entrevista", "interview")),
    ("recruiting", ("reclutamiento", "recruiter", "recruiting", "talent acquisition")),
    (
        "employment",
        (
            "oportunidad laboral",
            "oferta laboral",
            "puesto de trabajo",
            "contratar",
            "hire you",
            "quiero contactarme con lucas",
            "contactar a lucas",
            "contactar con lucas",
            "hablar con lucas",
            "comunicarme con lucas",
            "escribirle a lucas",
            "ponerme en contacto con lucas",
        ),
    ),
)


def _single_line(value: str, *, maximum: int, required: bool) -> str:
    normalized = value.strip()
    if (required and not normalized) or len(normalized) > maximum:
        raise ValueError("invalid_length")
    if "\n" in normalized or "\r" in normalized or _CONTROL.search(normalized):
        raise ValueError("invalid_characters")
    return normalized


class ContactSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    submission_version: Literal["1"]
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    email: str = Field(min_length=3, max_length=EMAIL_MAX_LENGTH)
    company: str | None = Field(default=None, max_length=COMPANY_MAX_LENGTH)
    message: str = Field(min_length=1, max_length=MESSAGE_MAX_LENGTH)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return _single_line(value, maximum=NAME_MAX_LENGTH, required=True)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        email = _single_line(value, maximum=EMAIL_MAX_LENGTH, required=True)
        if len(email) < 3 or not _EMAIL.fullmatch(email):
            raise ValueError("invalid_email")
        return email

    @field_validator("company")
    @classmethod
    def validate_company(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return _single_line(value, maximum=COMPANY_MAX_LENGTH, required=False)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or len(normalized) > MESSAGE_MAX_LENGTH or _CONTROL.search(normalized):
            raise ValueError("invalid_message")
        return normalized


class ContactSubmissionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    outcome: ContactOutcome
    retryable: bool
    request_id: str
    field_errors: dict[Literal["name", "email", "company", "message"], str] | None = None


class InterviewContactFormPart(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["interview_contact_form"] = "interview_contact_form"
    form_version: Literal["1"] = CONTACT_FORM_VERSION
    submission_version: Literal["1"] = CONTACT_SUBMISSION_VERSION
    intent: ContactIntent
    fields: tuple[Literal["name"], Literal["email"], Literal["company"], Literal["message"]] = (
        "name",
        "email",
        "company",
        "message",
    )


def classify_contact_intent(message: str) -> ContactIntent | None:
    """Return only high-confidence, non-refused employment contact intent."""
    normalized = unicodedata.normalize("NFKC", message).casefold()
    if any(phrase in normalized for phrase in _REFUSALS):
        return None
    matches = [
        intent for intent, phrases in _INTENT_PHRASES if any(p in normalized for p in phrases)
    ]
    return matches[0] if len(set(matches)) == 1 else None


GuardDecision = Literal[
    "reserved",
    "duplicate_processing",
    "duplicate_accepted",
    "delivery_uncertain",
    "idempotency_conflict",
    "throttled",
]


@dataclass(slots=True)
class _Reservation:
    payload_digest: str
    status: Literal["processing", "accepted", "uncertain"]
    expires_at: float


class EphemeralSubmissionGuard:
    """Lock-protected HMAC-only process-local rate and idempotency state."""

    def __init__(
        self,
        secret: str,
        *,
        ttl_seconds: int = 900,
        rate_window_seconds: int = 600,
        rate_limit: int = 5,
        capacity: int = 2_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not secret or ttl_seconds <= 0 or rate_limit <= 0 or capacity <= 0:
            raise ValueError("invalid guard configuration")
        self._secret = secret.encode()
        self._ttl = ttl_seconds
        self._rate_window = rate_window_seconds
        self._rate_limit = rate_limit
        self._capacity = capacity
        self._clock = clock
        self._entries: dict[str, _Reservation] = {}
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def digest(self, value: str) -> str:
        return hmac.new(self._secret, value.encode(), hashlib.sha256).hexdigest()

    def reserve(
        self, client_identity: str, idempotency_key: str, payload_fingerprint: str
    ) -> GuardDecision:
        now = float(self._clock())
        client_key = self.digest(f"client:{client_identity}")
        key = self.digest(f"idempotency:{idempotency_key}")
        payload = self.digest(f"payload:{payload_fingerprint}")
        with self._lock:
            self._expire(now)
            existing = self._entries.get(key)
            if existing:
                if not hmac.compare_digest(existing.payload_digest, payload):
                    return "idempotency_conflict"
                replay: dict[Literal["processing", "accepted", "uncertain"], GuardDecision] = {
                    "processing": "duplicate_processing",
                    "accepted": "duplicate_accepted",
                    "uncertain": "delivery_uncertain",
                }
                return replay[existing.status]
            attempts = self._attempts[client_key]
            while attempts and attempts[0] <= now - self._rate_window:
                attempts.popleft()
            if len(attempts) >= self._rate_limit:
                return "throttled"
            attempts.append(now)
            if len(self._entries) >= self._capacity:
                oldest = min(self._entries, key=lambda item: self._entries[item].expires_at)
                del self._entries[oldest]
            self._entries[key] = _Reservation(payload, "processing", now + self._ttl)
            return "reserved"

    def mark_accepted(self, idempotency_key: str) -> None:
        self._transition(idempotency_key, "accepted")

    def mark_uncertain(self, idempotency_key: str) -> None:
        self._transition(idempotency_key, "uncertain")

    def release(self, idempotency_key: str) -> None:
        with self._lock:
            self._entries.pop(self.digest(f"idempotency:{idempotency_key}"), None)

    def _transition(self, idempotency_key: str, status: Literal["accepted", "uncertain"]) -> None:
        with self._lock:
            reservation = self._entries.get(self.digest(f"idempotency:{idempotency_key}"))
            if reservation:
                reservation.status = status

    def _expire(self, now: float) -> None:
        for key in [key for key, entry in self._entries.items() if entry.expires_at <= now]:
            del self._entries[key]
        for key in [
            key
            for key, values in self._attempts.items()
            if not values or values[-1] <= now - self._rate_window
        ]:
            del self._attempts[key]
