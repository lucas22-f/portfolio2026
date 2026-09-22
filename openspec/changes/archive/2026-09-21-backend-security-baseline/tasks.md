# Tasks: Backend Security Baseline

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 600–800 additions and deletions across the guard, transport wiring, contact validation, and regression tests |
| 400-line budget risk | High |
| Chained PRs recommended | Yes, but the requested single-PR delivery requires an approved size exception |
| Suggested split | Work unit 1: guard and unit coverage → Work unit 2: FastAPI wiring and integration/regression coverage; deliver together as one size-exception PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Add the dependency-free bounded chat guard, preserve contact guard defaults/validation, and prove guard behavior in isolation | PR 1 (single-PR size exception) | `poetry run python -m pytest tests/test_chat_admission.py tests/test_contact.py -q` | Direct guard calls with an injected monotonic clock; no external service required | Revert `backend/app/application/chat_admission.py` and the contact-guard changes in `backend/app/application/contact.py` plus their tests |
| 2 | Wire admission into the FastAPI stream boundary and verify safe rejection, cleanup, forwarded-header behavior, and provider regressions | PR 1 (single-PR size exception) | `poetry run python -m pytest tests/test_api.py tests/test_chat_provider.py -q` | `TestClient(create_app(...))` with counting retriever/provider and a one-slot streaming guard; no external service required | Revert chat admission wiring in `backend/app/main.py` and the related API/provider tests |

Strict TDD is inactive in `openspec/config.yaml`; testing tasks therefore name exact focused pytest commands rather than separate RED/GREEN tasks.

## Phase 1: Foundation and Guard State

- [x] 1.1 Create `backend/app/application/chat_admission.py` with frozen `ChatAdmissionConfig`, `AdmissionLease`, `AdmissionDecision`, and lock-protected `ChatAdmissionGuard` interfaces from the design; implement defaults of 10 admissions per 60 seconds, 2 active streams per peer, 32 active streams per process, 2,000 peer records, and a 5-second retry hint.
- [x] 1.2 Implement bounded configuration parsing in `backend/app/application/chat_admission.py` for all `CHAT_ADMISSION_*` variables, accepting missing values as safe defaults and raising `ValueError` for malformed, non-positive, or out-of-range values instead of disabling admission or creating unbounded state.
- [x] 1.3 Implement HMAC-derived peer keys, frequency-window pruning, peer/process concurrency accounting, safe state-capacity rejection, and idempotent lease release in `backend/app/application/chat_admission.py`; retain no raw peer, request body, prompt, or personal data in guard state.
- [x] 1.4 Modify `backend/app/application/contact.py` to make the existing process-local HMAC guard defaults explicit (`5/600s` rate, `900s` idempotency TTL, capacity `2,000`), validate every configured limit/window/TTL/capacity against bounded ranges, and preserve fail-closed `ValueError` behavior.

## Phase 2: FastAPI and Contact Wiring

- [x] 2.1 Modify `backend/app/main.py` to construct the chat guard from validated environment configuration during application setup, inject it through the existing app factory seam, and expose an unavailable boundary when chat admission configuration is invalid rather than serving without protection.
- [x] 2.2 Modify `backend/app/main.py` at the `/api/v1/chat/stream` boundary to use only `request.client.host` (or reject safely when unavailable), call `try_admit()` before readiness checks, retriever access, provider work, or graph-task creation, and return the stable HTTP 429 `throttled` JSON contract with bounded `Retry-After` guidance for every rejection reason.
- [x] 2.3 Modify the streaming generator in `backend/app/main.py` so graph creation, the initial SSE event, normal forwarding, cancellation, provider failure, and internal failure are enclosed by one outer `finally` that cancels unfinished work and releases the admission lease exactly once; retain category-only diagnostics without request content or peer identity.
- [x] 2.4 Modify `backend/app/main.py` contact wiring to pass the authoritative transport peer to the existing contact guard, ignore forwarded-IP headers, preserve Brevo delivery and duplicate/idempotency outcomes, and convert invalid contact-guard configuration to the existing safe unavailable behavior.

## Phase 3: Focused Verification

- [x] 3.1 Create `backend/tests/test_chat_admission.py` covering default configuration, every invalid and over-bound environment value, admission of a peer within baseline, rejection of the 11th attempt, per-peer and process-wide concurrency limits, peer isolation, missing-peer rejection, expiry, bounded-capacity rejection, HMAC-only state, and idempotent release; verify with `poetry run python -m pytest tests/test_chat_admission.py -q`.
- [x] 3.2 Modify `backend/tests/test_api.py` to cover the stable 429 status/body/header and payload-free response for frequency, peer-concurrency, process-concurrency, state-capacity, and missing-peer rejection; assert rejected requests perform zero readiness, retriever, provider, token/cost, or graph work with `poetry run python -m pytest tests/test_api.py -q`.
- [x] 3.3 Modify `backend/tests/test_api.py` to send different `X-Forwarded-For` and `Forwarded` values from the same transport peer and prove they cannot bypass limits; cover independent authoritative peers and normal, cancelled, provider-failed, and internally failed streams releasing a one-slot lease with `poetry run python -m pytest tests/test_api.py -q`.
- [x] 3.4 Modify `backend/tests/test_contact.py` to verify explicit `5/600s`, `900s`, and `2,000` defaults, invalid configuration rejection, authoritative-peer identity, forwarded-header non-bypass, bounded state, replay/idempotency, uncertain delivery, and capacity behavior without changing Brevo request/outcome semantics; verify with `poetry run python -m pytest tests/test_contact.py -q`.
- [x] 3.5 Modify `backend/tests/test_chat_provider.py` with explicit regression assertions that the existing model, token, timeout, projected-cost, and actual-cost defaults remain unchanged when admission is present; verify with `poetry run python -m pytest tests/test_chat_provider.py -q`.

## Phase 4: Repository Verification and Delivery Readiness

- [x] 4.1 Run the complete affected backend regression set with `poetry run python -m pytest tests/test_chat_admission.py tests/test_api.py tests/test_contact.py tests/test_chat_provider.py -q` and confirm all proposal/spec scenarios are covered without frontend, mobile, dependency-installation, or external-service work.
- [x] 4.2 Run `poetry run ruff check app tests --output-format=concise`, `poetry run mypy app`, and `poetry check --lock`; resolve only regressions introduced by this change.
- [x] 4.3 Before implementation begins, obtain the required `size:exception` approval for the single-PR delivery because the estimated change exceeds the 400-line review budget; otherwise stop and split the work into the two suggested review units.
