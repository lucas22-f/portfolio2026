"""Bounded process-local admission control for anonymous chat streams."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True, slots=True)
class ChatAdmissionConfig:
    rate_limit: int = 10
    rate_window_seconds: int = 60
    per_peer_concurrency: int = 2
    process_concurrency: int = 32
    peer_capacity: int = 2_000
    retry_after_seconds: int = 5

    def __post_init__(self) -> None:
        bounds = {
            "rate_limit": (self.rate_limit, 100),
            "rate_window_seconds": (self.rate_window_seconds, 3_600),
            "per_peer_concurrency": (self.per_peer_concurrency, 16),
            "process_concurrency": (self.process_concurrency, 256),
            "peer_capacity": (self.peer_capacity, 2_000),
            "retry_after_seconds": (self.retry_after_seconds, 60),
        }
        if any(value <= 0 or value > maximum for value, maximum in bounds.values()):
            raise ValueError("invalid chat admission configuration")

    @classmethod
    def from_environment(cls, environ: Mapping[str, str]) -> ChatAdmissionConfig:
        names = {
            "rate_limit": "CHAT_ADMISSION_RATE_LIMIT",
            "rate_window_seconds": "CHAT_ADMISSION_RATE_WINDOW_SECONDS",
            "per_peer_concurrency": "CHAT_ADMISSION_PER_PEER_CONCURRENCY",
            "process_concurrency": "CHAT_ADMISSION_PROCESS_CONCURRENCY",
            "peer_capacity": "CHAT_ADMISSION_PEER_CAPACITY",
            "retry_after_seconds": "CHAT_ADMISSION_RETRY_AFTER_SECONDS",
        }
        defaults = cls()
        values: dict[str, int] = {}
        try:
            for field_name, environment_name in names.items():
                default = str(getattr(defaults, field_name))
                values[field_name] = int(environ.get(environment_name, default))
        except (TypeError, ValueError) as error:
            raise ValueError("invalid chat admission configuration") from error
        return cls(**values)


@dataclass(frozen=True, slots=True)
class AdmissionLease:
    peer_key: str
    token: int


AdmissionReason = Literal[
    "admitted",
    "frequency",
    "peer_concurrency",
    "process_concurrency",
    "state_capacity",
    "missing_peer",
]


@dataclass(frozen=True, slots=True)
class AdmissionDecision:
    accepted: bool
    reason: AdmissionReason
    lease: AdmissionLease | None = None


@dataclass(slots=True)
class _PeerState:
    admissions: deque[float] = field(default_factory=deque)
    active: int = 0


class ChatAdmissionGuard:
    """Lock-protected, HMAC-keyed frequency and concurrency admission state."""

    def __init__(
        self,
        config: ChatAdmissionConfig | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        secret: bytes | None = None,
    ) -> None:
        self.config = config or ChatAdmissionConfig()
        self._clock = clock
        self._secret = secret or secrets.token_bytes(32)
        self._peers: dict[str, _PeerState] = {}
        self._leases: dict[int, str] = {}
        self._process_active = 0
        self._next_token = 1
        self._lock = threading.Lock()

    @classmethod
    def from_environment(cls, environ: Mapping[str, str]) -> ChatAdmissionGuard:
        return cls(ChatAdmissionConfig.from_environment(environ))

    def try_admit(self, transport_peer: str | None) -> AdmissionDecision:
        if transport_peer is None or not transport_peer.strip():
            return AdmissionDecision(False, "missing_peer")
        now = float(self._clock())
        peer_key = hmac.new(self._secret, transport_peer.encode(), hashlib.sha256).hexdigest()
        with self._lock:
            self._prune(now)
            peer = self._peers.get(peer_key)
            if peer is None:
                if len(self._peers) >= self.config.peer_capacity:
                    return AdmissionDecision(False, "state_capacity")
                peer = _PeerState()
                self._peers[peer_key] = peer
            if len(peer.admissions) >= self.config.rate_limit:
                return AdmissionDecision(False, "frequency")
            if peer.active >= self.config.per_peer_concurrency:
                return AdmissionDecision(False, "peer_concurrency")
            if self._process_active >= self.config.process_concurrency:
                return AdmissionDecision(False, "process_concurrency")
            token = self._next_token
            self._next_token += 1
            peer.admissions.append(now)
            peer.active += 1
            self._process_active += 1
            self._leases[token] = peer_key
            lease = AdmissionLease(peer_key, token)
            return AdmissionDecision(True, "admitted", lease)

    def release(self, lease: AdmissionLease) -> None:
        now = float(self._clock())
        with self._lock:
            peer_key = self._leases.get(lease.token)
            if peer_key is None or not hmac.compare_digest(peer_key, lease.peer_key):
                return
            del self._leases[lease.token]
            peer = self._peers.get(peer_key)
            if peer is not None and peer.active > 0:
                peer.active -= 1
                self._process_active -= 1
            self._prune(now)

    def _prune(self, now: float) -> None:
        cutoff = now - self.config.rate_window_seconds
        removable: list[str] = []
        for peer_key, peer in self._peers.items():
            while peer.admissions and peer.admissions[0] <= cutoff:
                peer.admissions.popleft()
            if peer.active == 0 and not peer.admissions:
                removable.append(peer_key)
        for peer_key in removable:
            del self._peers[peer_key]
