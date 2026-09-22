# Design: Backend Security Baseline

## Technical Approach

Add a small, dependency-free, process-local admission guard at the FastAPI chat
transport boundary. The guard evaluates the authoritative `request.client.host`
before readiness checks, retriever work, provider work, or graph-task creation.
It records only bounded, HMAC-derived peer state and returns a stable HTTP 429
JSON response when frequency or concurrency admission fails.

Accepted requests receive an in-flight lease. The existing streaming graph and
provider path remain unchanged, including the current model, token, timeout,
projected-cost, and actual-cost controls. The streaming generator will own the
lease cleanup in a `finally` block that encloses graph creation and the initial
SSE yield, so normal completion, cancellation, provider failure, and internal
failure all release capacity.

The contact endpoint remains on its existing `EphemeralSubmissionGuard` and
Brevo delivery adapter. Its process-local HMAC identity, defaults, bounded
state, and fail-closed configuration behavior become explicit and are covered
by regression tests; no delivery contract or provider behavior changes.

## Architecture Decisions

### Decision: Keep chat admission in a dedicated application guard

**Choice**: Create `backend/app/application/chat_admission.py` with a frozen
configuration object and a lock-protected `ChatAdmissionGuard`.

**Alternatives considered**: Add counters directly to `main.py`; use a third-
party rate-limiter package; or coordinate through Redis.

**Rationale**: A dedicated guard keeps transport wiring small and makes the
frequency, peer concurrency, process concurrency, expiry, and configuration
rules unit-testable. The current deployment is a single FastAPI service and
the proposal explicitly excludes new dependencies and shared infrastructure.
The process-local limitation is therefore intentional and documented rather
than hidden behind a more complex abstraction.

### Decision: Use only the authoritative transport peer

**Choice**: `main.py` extracts `request.client.host` (or rejects safely when
the transport peer is unavailable). Forwarded-IP headers are never read.
The chat guard derives an internal HMAC key from the peer using a random
process-local secret and stores the digest, not the raw host value.

**Alternatives considered**: Prefer `X-Forwarded-For`; accept a caller-provided
identity; or store the raw host string.

**Rationale**: The deployment has no documented trusted-proxy boundary, so
forwarded headers are attacker-controlled. A process-local HMAC digest keeps
the guard state non-PII and prevents the in-memory table from retaining raw
transport addresses while preserving per-peer behavior within the process.

### Decision: Admit with a lease and release in the generator's outer `finally`

**Choice**: `try_admit()` atomically increments the peer and process active
counts and returns an `AdmissionLease`. `release()` is idempotent and consumes
that lease exactly once. `response_generator()` places graph creation, the
initial `start` event, normal event forwarding, exception handling, and graph
cancellation inside one outer `try/finally`.

**Alternatives considered**: Release immediately after returning
`StreamingResponse`; release only in the existing inner exception handler; or
rely on expiry to recover leaked streams.

**Rationale**: A `StreamingResponse` is consumed after the route returns, so
route-level cleanup would release capacity too early. The existing generator
has an initial yield before its current `try`, which could leak a newly added
lease if the client disconnects at that point. One outer `finally` covers that
boundary and makes cleanup deterministic; expiry remains a bounded-state
safety net, not the normal lifecycle mechanism.

### Decision: Return a stable HTTP 429 response for admission rejection

**Choice**: Reject frequency, per-peer concurrency, process concurrency, state
capacity, and missing-peer admission failures with HTTP 429 and this stable,
payload-free shape:

```json
{
  "code": "throttled",
  "message": "El servicio está temporalmente ocupado. Intentá nuevamente en unos segundos.",
  "retryable": true,
  "retry_after_seconds": 5
}
```

Also send `Retry-After: 5`. The retry value is a bounded hint, not a promise
that the frequency window has expired. The response does not include a request
ID, peer identity, counters, provider diagnostics, or request content.

**Alternatives considered**: Start an SSE stream containing an error event;
return a different response for each rejection reason; or expose the exact
remaining counter/window.

**Rationale**: Rejection happens before graph creation, so a normal JSON error
avoids pretending that a stream started. A single public outcome prevents
information disclosure about internal state and gives clients a stable,
retryable contract. Category-only logs may retain the internal rejection
reason for operations without returning it to callers.

### Decision: Fail closed for invalid admission configuration

**Choice**: Parse chat admission environment values during `_default_app()`
construction. Missing values use safe defaults; present values must parse as
integers and remain within explicit bounds. Invalid configuration produces an
unavailable application boundary rather than disabling the guard or creating
unbounded state.

Chat configuration and bounds are:

| Environment variable | Default | Allowed range |
|---|---:|---:|
| `CHAT_ADMISSION_RATE_LIMIT` | `10` | `1..100` |
| `CHAT_ADMISSION_RATE_WINDOW_SECONDS` | `60` | `1..3,600` |
| `CHAT_ADMISSION_PER_PEER_CONCURRENCY` | `2` | `1..16` |
| `CHAT_ADMISSION_PROCESS_CONCURRENCY` | `32` | `1..256` |
| `CHAT_ADMISSION_PEER_CAPACITY` | `2,000` | `1..2,000` |
| `CHAT_ADMISSION_RETRY_AFTER_SECONDS` | `5` | `1..60` |

The guard prunes expired inactive peer records on each admission/bookkeeping
operation. If the peer table is full and no expired/inactive record can be
removed safely, it rejects the new admission instead of evicting active or
recent frequency state.

**Alternatives considered**: Silently fall back to defaults for malformed
values; allow arbitrary environment values; or fail open while logging a
configuration warning.

**Rationale**: Silent fallback can make an operator believe a stricter policy
is active when it is not. Explicit upper bounds protect memory and concurrency,
and fail-closed behavior satisfies the security contract without introducing a
new startup dependency.

### Decision: Preserve and clarify the contact guard rather than unify guards

**Choice**: Keep `EphemeralSubmissionGuard` as the contact-specific HMAC rate
and idempotency guard. Make its defaults explicit (`5` attempts per `600`
seconds, `900` second idempotency TTL, `2,000` entries), validate every timing,
limit, and capacity input, and use the same transport-peer extraction rule in
`main.py`.

**Alternatives considered**: Reuse the chat guard for contact submissions;
change the existing defaults; or add persistent/shared contact state.

**Rationale**: Contact idempotency and delivery uncertainty have semantics that
are different from chat stream admission. Keeping the existing guard avoids
changing Brevo behavior or the public contact contract. The clarification
documents the current process-local HMAC-only boundary and prevents accidental
trust in forwarded headers.

## Data Flow

### Startup configuration

```text
environment
    │
    ▼
ChatAdmissionConfig.from_environment()
    │ valid                         │ invalid
    ▼                               ▼
ChatAdmissionGuard             unavailable app boundary
    │
    └──────────────► create_app(chat_admission=guard)
```

The contact guard continues to be built from its existing environment variables
after delivery configuration. A `ValueError` leaves contact delivery disabled,
which is the current fail-closed behavior; the clarified validation prevents
invalid windows or unbounded values from being accepted.

### Accepted and rejected chat request

```text
POST /api/v1/chat/stream
        │
        ▼
Pydantic request validation
        │
        ▼
request.client.host ──► ChatAdmissionGuard.try_admit()
        │                         │
        │ rejected                │ admitted: lease
        ▼                         ▼
HTTP 429 JSON              readiness check
no graph/provider work           │
                                  ▼
                           build state + generator
                                  │
                                  ▼
                           create graph task
                                  │
                                  ▼
                           SSE stream lifecycle
                                  │
                                  ▼
                         finally: cancel task if needed,
                                  release lease, category-only log
```

The rejection branch occurs before the existing readiness check, retriever
access, `run_chat_graph()` task creation, and provider invocation. The accepted
branch continues through the existing chat contract and provider ceilings.

### Contact submission

```text
request body + Idempotency-Key
        │
        ▼
content/size/JSON/schema validation
        │
        ▼
authoritative request.client.host + HMAC guard
        │ accepted
        ▼
BrevoContactDelivery.deliver()
        │
        ▼
existing accepted / duplicate / uncertain / retryable outcomes
```

No contact message, email address, or raw request body is added to abuse
control state. The existing raw-body fingerprint remains a digest used for
idempotency conflict detection only.

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/app/application/chat_admission.py` | Create | Define bounded chat configuration, HMAC-derived peer state, admission decisions, leases, expiry, and lock-protected release. |
| `backend/app/main.py` | Modify | Parse/inject chat admission configuration, extract only `request.client.host`, reject before readiness/provider work, emit the stable 429 response, and release leases from the outer streaming `finally`. Clarify contact peer extraction and fail-closed configuration wiring. |
| `backend/app/application/contact.py` | Modify | Publish explicit contact defaults/bounds and validate the rate window, TTL, rate limit, and capacity while preserving HMAC-only process-local semantics. |
| `backend/tests/test_chat_admission.py` | Create | Unit-test defaults, configuration bounds, frequency, peer/process concurrency, peer isolation, expiry, bounded capacity, HMAC-only state, and idempotent release. |
| `backend/tests/test_api.py` | Modify | Test HTTP throttling and retry shape, forwarded-header non-bypass, admission ordering, normal/cancelled/failed stream cleanup, and preserved contact delivery/replay behavior. |
| `backend/tests/test_contact.py` | Modify | Test explicit contact defaults, invalid configuration rejection, authoritative-peer behavior, and existing rate/idempotency/concurrency boundaries. |
| `backend/tests/test_chat_provider.py` | Modify | Add a regression assertion that the existing provider model/token/timeout/projected-cost defaults remain unchanged when admission is present. |
| `openspec/changes/backend-security-baseline/design.md` | Create | Record this hybrid technical design. |

No changes are planned for `backend/app/infrastructure/contact_delivery.py`,
the frontend/mobile clients, provider request construction, dependency files,
or deployment infrastructure.

## Interfaces / Contracts

### Chat admission application interface

The application layer exposes a transport-neutral guard; FastAPI `Request`
objects remain in `main.py` rather than leaking into the guard.

```python
@dataclass(frozen=True, slots=True)
class ChatAdmissionConfig:
    rate_limit: int = 10
    rate_window_seconds: int = 60
    per_peer_concurrency: int = 2
    process_concurrency: int = 32
    peer_capacity: int = 2_000
    retry_after_seconds: int = 5


@dataclass(frozen=True, slots=True)
class AdmissionLease:
    peer_key: str
    token: int


@dataclass(frozen=True, slots=True)
class AdmissionDecision:
    accepted: bool
    reason: Literal[
        "admitted",
        "frequency",
        "peer_concurrency",
        "process_concurrency",
        "state_capacity",
        "missing_peer",
    ]
    lease: AdmissionLease | None = None


class ChatAdmissionGuard:
    @classmethod
    def from_environment(cls, environ: Mapping[str, str]) -> "ChatAdmissionGuard": ...

    def try_admit(self, transport_peer: str | None) -> AdmissionDecision: ...

    def release(self, lease: AdmissionLease) -> None: ...
```

`release()` is idempotent. The guard stores HMAC peer keys, timestamp deques,
active counts, and at most the configured number of peer records. It never
stores the message, request body, client request ID, or raw transport peer.

### Chat rejection HTTP contract

```text
Status: 429 Too Many Requests
Header: Retry-After: 5
Content-Type: application/json

{
  "code": "throttled",
  "message": "El servicio está temporalmente ocupado. Intentá nuevamente en unos segundos.",
  "retryable": true,
  "retry_after_seconds": 5
}
```

The numeric header/body value is taken from the validated configuration and is
always within the `1..60` bound. The public contract is identical for all
admission rejection reasons.

### Contact guard contract

`EphemeralSubmissionGuard` keeps its existing methods and outcomes:

```python
guard.reserve(authoritative_transport_peer, idempotency_key, payload_digest)
guard.mark_accepted(idempotency_key)
guard.mark_uncertain(idempotency_key)
guard.release(idempotency_key)
```

Its defaults remain `ttl_seconds=900`, `rate_window_seconds=600`,
`rate_limit=5`, and `capacity=2_000`. Its accepted configuration ranges are
positive values with `ttl_seconds` and `rate_window_seconds` at most `86,400`,
`rate_limit` at most `100`, and `capacity` at most `2,000`. Invalid values
raise `ValueError`; `_default_app()` converts that failure into the existing
safe unavailable contact behavior instead of disabling protection silently.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Chat defaults and configuration | Construct the default guard and assert `10/60`, `2`, `32`, bounded capacity, and retry guidance. Parameterize malformed, zero, negative, and over-maximum values; assert construction raises `ValueError`. |
| Unit | Frequency and concurrency | Use an injected monotonic clock and direct authoritative peer values. Admit ten attempts, reject the eleventh, verify two active leases per peer, verify 32 active leases process-wide, and verify release permits the next request. |
| Unit | Identity and bounded state | Pass different peer values with arbitrary forwarded-header strings outside the guard; assert only the peer argument changes state. Assert raw peer values and request content are absent from guard state/repr, expiry removes inactive records, and a full table rejects safely rather than evicting active/recent state. |
| Unit | Contact guard regression | Preserve replay, conflict, uncertain, TTL, rate, capacity, and lock tests. Add zero/over-bound configuration cases and verify the existing HMAC digest does not expose the raw peer. |
| Integration | HTTP rejection contract | Use `TestClient(create_app(...))` with an injected small guard and counting retriever/provider. Assert 429, stable code/message/retry fields, `Retry-After`, no payload/peer/counter/provider details, and zero provider/retriever/graph work. |
| Integration | Forwarded-header behavior | Send repeated requests with different `X-Forwarded-For`/`Forwarded` values from the same TestClient transport peer; assert the peer limit is shared. Exercise distinct peer values directly through the guard because TestClient does not provide a portable remote-address override. |
| Integration | Stream lifecycle cleanup | With a one-slot guard, complete a normal stream, force a provider/internal failure, and cancel/close a streaming client while work is active. Assert a subsequent request can acquire the released slot and graph tasks are cancelled. |
| Regression | Provider and contact behavior | Run existing provider ceiling tests and add explicit `ProviderLimits` default assertions. Keep Brevo request-shape and failure classification tests unchanged; run the contact endpoint replay test to prove one delivery remains one delivery. |
| Quality | Repository checks | Run the scoped backend pytest files, `poetry run ruff check app tests --output-format=concise`, and `poetry run mypy app`. No frontend, mobile, browser, or dependency-installation work is required. |

## Threat Matrix

N/A — no routing changes, shell commands, subprocesses, VCS/PR automation,
executable-file classification, or process-integration boundary are specified.
The process-local application admission guard is ordinary in-process request
state, not subprocess or external process integration.

## Migration / Rollout

No migration required. The guard is in-memory and intentionally resets on
process restart. Deploy with the documented defaults first; operators may use
the bounded `CHAT_ADMISSION_*` environment overrides without a data migration.
Rollback is a code/config revert that removes chat admission wiring while
leaving provider ceilings, contact validation, HMAC idempotency, and Brevo
delivery independently usable.

## Open Questions

- None blocking. The proposed retry hint is a stable five-second bounded hint,
  not an exact frequency-window calculation, to avoid exposing internal state.
