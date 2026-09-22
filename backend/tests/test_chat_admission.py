from __future__ import annotations

import pytest

from app.application.chat_admission import ChatAdmissionConfig, ChatAdmissionGuard


def test_default_configuration_matches_security_baseline() -> None:
    config = ChatAdmissionConfig()

    assert config == ChatAdmissionConfig(
        rate_limit=10,
        rate_window_seconds=60,
        per_peer_concurrency=2,
        process_concurrency=32,
        peer_capacity=2_000,
        retry_after_seconds=5,
    )


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("CHAT_ADMISSION_RATE_LIMIT", "bad"),
        ("CHAT_ADMISSION_RATE_LIMIT", "0"),
        ("CHAT_ADMISSION_RATE_LIMIT", "101"),
        ("CHAT_ADMISSION_RATE_WINDOW_SECONDS", "0"),
        ("CHAT_ADMISSION_RATE_WINDOW_SECONDS", "3601"),
        ("CHAT_ADMISSION_PER_PEER_CONCURRENCY", "0"),
        ("CHAT_ADMISSION_PER_PEER_CONCURRENCY", "17"),
        ("CHAT_ADMISSION_PROCESS_CONCURRENCY", "0"),
        ("CHAT_ADMISSION_PROCESS_CONCURRENCY", "257"),
        ("CHAT_ADMISSION_PEER_CAPACITY", "0"),
        ("CHAT_ADMISSION_PEER_CAPACITY", "2001"),
        ("CHAT_ADMISSION_RETRY_AFTER_SECONDS", "0"),
        ("CHAT_ADMISSION_RETRY_AFTER_SECONDS", "61"),
    ],
)
def test_environment_configuration_rejects_malformed_and_unbounded_values(
    name: str, value: str
) -> None:
    with pytest.raises(ValueError, match="invalid chat admission configuration"):
        ChatAdmissionGuard.from_environment({name: value})


def test_frequency_limit_rejects_eleventh_admission_until_window_expires() -> None:
    now = [10.0]
    guard = ChatAdmissionGuard(clock=lambda: now[0], secret=b"test-secret")

    for _ in range(10):
        decision = guard.try_admit("203.0.113.1")
        assert decision.accepted and decision.lease is not None
        guard.release(decision.lease)

    assert guard.try_admit("203.0.113.1").reason == "frequency"
    now[0] = 71.0
    assert guard.try_admit("203.0.113.1").accepted


def test_peer_concurrency_is_isolated_and_release_is_idempotent() -> None:
    guard = ChatAdmissionGuard(
        ChatAdmissionConfig(per_peer_concurrency=2), secret=b"test-secret"
    )
    first = guard.try_admit("peer-a")
    second = guard.try_admit("peer-a")

    assert first.lease is not None and second.lease is not None
    assert guard.try_admit("peer-a").reason == "peer_concurrency"
    assert guard.try_admit("peer-b").accepted
    guard.release(first.lease)
    guard.release(first.lease)
    assert guard.try_admit("peer-a").accepted


def test_process_concurrency_rejects_across_distinct_peers() -> None:
    guard = ChatAdmissionGuard(
        ChatAdmissionConfig(process_concurrency=2), secret=b"test-secret"
    )

    assert guard.try_admit("peer-a").accepted
    assert guard.try_admit("peer-b").accepted
    assert guard.try_admit("peer-c").reason == "process_concurrency"


def test_missing_peer_and_full_recent_state_fail_closed_without_raw_identity() -> None:
    now = [10.0]
    guard = ChatAdmissionGuard(
        ChatAdmissionConfig(peer_capacity=1), clock=lambda: now[0], secret=b"test-secret"
    )

    assert guard.try_admit(None).reason == "missing_peer"
    admitted = guard.try_admit("private-peer-address")
    assert admitted.lease is not None
    guard.release(admitted.lease)
    assert guard.try_admit("another-peer").reason == "state_capacity"
    assert "private-peer-address" not in repr(guard.__dict__)

    now[0] = 71.0
    assert guard.try_admit("another-peer").accepted
