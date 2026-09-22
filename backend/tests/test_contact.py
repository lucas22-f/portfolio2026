from __future__ import annotations

import threading

import pytest
from pydantic import ValidationError

from app.application.contact import (
    CONTACT_FIELDS,
    DEFAULT_CONTACT_GUARD_CAPACITY,
    DEFAULT_CONTACT_IDEMPOTENCY_TTL_SECONDS,
    DEFAULT_CONTACT_RATE_LIMIT,
    DEFAULT_CONTACT_RATE_WINDOW_SECONDS,
    ContactSubmission,
    EphemeralSubmissionGuard,
    InterviewContactFormPart,
    classify_contact_intent,
)


def valid_submission(**overrides: object) -> ContactSubmission:
    payload: dict[str, object] = {
        "submission_version": "1",
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "company": None,
        "message": "I would like to arrange an interview.",
    }
    payload.update(overrides)
    return ContactSubmission.model_validate(payload)


def test_submission_contract_is_strict_and_normalizes_optional_company() -> None:
    assert valid_submission(company="   ").company is None
    assert valid_submission(company=" Analytical Engines ").company == "Analytical Engines"
    with pytest.raises(ValidationError):
        valid_submission(extra="rejected")
    with pytest.raises(ValidationError):
        valid_submission(name="x\nBcc: victim@example.com")
    with pytest.raises(ValidationError):
        valid_submission(email="not-an-email")
    with pytest.raises(ValidationError):
        valid_submission(message="x\x00y")


def test_form_part_has_fixed_versions_and_field_order() -> None:
    part = InterviewContactFormPart(intent="interview")
    assert part.model_dump() == {
        "type": "interview_contact_form",
        "form_version": "1",
        "submission_version": "1",
        "intent": "interview",
        "fields": CONTACT_FIELDS,
    }


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Quiero coordinar una entrevista", "interview"),
        ("I am a recruiter", "recruiting"),
        ("Tenemos una oportunidad laboral", "employment"),
        ("quiero contactarme con Lucas", "employment"),
        ("contactar a Lucas", "employment"),
        ("contactar con Lucas", "employment"),
        ("hablar con Lucas", "employment"),
        ("comunicarme con Lucas", "employment"),
        ("escribirle a Lucas", "employment"),
        ("ponerme en contacto con Lucas", "employment"),
        ("Me gusta tu trabajo", None),
        ("No me contactes para una entrevista", None),
        ("no quiero contactarme con Lucas", None),
        ("no quiero contactar a Lucas", None),
        ("Recruiter interview", None),
    ],
)
def test_classifier_is_conservative(message: str, expected: str | None) -> None:
    assert classify_contact_intent(message) == expected


def test_guard_replay_conflict_release_uncertain_ttl_capacity_and_rate() -> None:
    now = [10.0]
    guard = EphemeralSubmissionGuard(
        "secret",
        ttl_seconds=10,
        rate_window_seconds=20,
        rate_limit=2,
        capacity=1,
        clock=lambda: now[0],
    )
    assert guard.reserve("client", "key-1", "payload-1") == "reserved"
    assert guard.reserve("client", "key-1", "payload-1") == "duplicate_processing"
    assert guard.reserve("client", "key-1", "different") == "idempotency_conflict"
    guard.mark_accepted("key-1")
    assert guard.reserve("client", "key-1", "payload-1") == "duplicate_accepted"
    assert guard.reserve("client", "key-2", "payload-2") == "reserved"
    guard.mark_uncertain("key-2")
    assert guard.reserve("client", "key-2", "payload-2") == "delivery_uncertain"
    assert guard.reserve("client", "key-3", "payload-3") == "throttled"
    now[0] = 31.0
    assert guard.reserve("client", "key-3", "payload-3") == "reserved"
    guard.release("key-3")
    assert guard.reserve("other", "key-3", "payload-3") == "reserved"


def test_guard_allows_only_one_concurrent_reservation() -> None:
    guard = EphemeralSubmissionGuard("secret")
    barrier = threading.Barrier(3)
    outcomes: list[str] = []

    def reserve() -> None:
        barrier.wait()
        outcomes.append(guard.reserve("client", "same-key", "same-payload"))

    threads = [threading.Thread(target=reserve) for _ in range(2)]
    for thread in threads:
        thread.start()
    barrier.wait()
    for thread in threads:
        thread.join()
    assert sorted(outcomes) == ["duplicate_processing", "reserved"]
    assert "Ada" not in repr(guard.__dict__)


def test_guard_defaults_are_explicit_and_identity_state_is_hmac_only() -> None:
    guard = EphemeralSubmissionGuard("secret")

    assert guard._ttl == DEFAULT_CONTACT_IDEMPOTENCY_TTL_SECONDS == 900
    assert guard._rate_window == DEFAULT_CONTACT_RATE_WINDOW_SECONDS == 600
    assert guard._rate_limit == DEFAULT_CONTACT_RATE_LIMIT == 5
    assert guard._capacity == DEFAULT_CONTACT_GUARD_CAPACITY == 2_000
    assert guard.reserve("private-peer", "key", "payload") == "reserved"
    assert "private-peer" not in repr(guard.__dict__)


@pytest.mark.parametrize(
    "overrides",
    [
        {"ttl_seconds": 0},
        {"ttl_seconds": 86_401},
        {"rate_window_seconds": 0},
        {"rate_window_seconds": 86_401},
        {"rate_limit": 0},
        {"rate_limit": 101},
        {"capacity": 0},
        {"capacity": 2_001},
    ],
)
def test_guard_rejects_invalid_or_unbounded_configuration(overrides: dict[str, int]) -> None:
    with pytest.raises(ValueError, match="invalid guard configuration"):
        EphemeralSubmissionGuard("secret", **overrides)
