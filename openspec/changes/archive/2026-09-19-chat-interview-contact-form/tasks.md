# Tasks: Chat Interview Contact Form

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Approximately 1,300–1,900 authored lines, excluding generated Spartan Helm copies; higher in the complete snapshot because tests and generated UI files are included |
| 400-line budget risk | High |
| Chained PRs recommended | Yes, but current delivery strategy is single-pr |
| Suggested split | Contract and backend foundation → chat negotiation → frontend form and integration → verification and rollout documentation |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

The design crosses the v5 SSE protocol, a new FastAPI endpoint, Resend delivery, ephemeral abuse/idempotency state, Angular client state, a new accessible form component, generated Spartan UI files, and broad backend/frontend tests. This is not an honest single-PR change under the 400-line review policy. Because the confirmed delivery strategy is `single-pr`, implementation MUST wait for maintainer approval of `size:exception`; tests, privacy coverage, and generated component files MUST NOT be compressed or omitted to fit the budget.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Establish fixed contact contracts, validation, intent classification, Resend adapter, and bounded non-PII guard | Single PR, `size:exception` (internal unit 1) | `poetry run python -m pytest tests/test_contact.py tests/test_contact_delivery.py -q` from `backend` | Start `poetry run uvicorn app.main:app --host 127.0.0.1 --port 8000` with `CONTACT_FORM_ENABLED=false`; verify metadata omits contact capabilities and no delivery occurs | Remove `backend/app/application/contact.py` and `backend/app/infrastructure/contact_delivery.py`, plus their tests, without reverting chat or frontend work |
| 2 | Wire server-owned intent eligibility, capability negotiation, fixed v5 form-part ordering, and the dedicated submission route | Single PR, `size:exception` (internal unit 2) | `poetry run python -m pytest tests/test_api.py -q` from `backend`; `npm test -- --include=src/app/features/chat/chat-client.spec.ts --watch=false` from `frontend` | With the feature gate enabled in a single-process local backend, exercise an eligible chat request with capability metadata and confirm one schema-only form part; repeat without capability and confirm text-only SSE | Disable `CONTACT_FORM_ENABLED` and revert only backend chat/route wiring plus `chat-client.ts` contract changes |
| 3 | Deliver the inline Angular lifecycle, accessible responsive UI, submission states, and chat transcript integration | Single PR, `size:exception` (internal unit 3) | `npm test -- --include=src/app/features/chat/interview-contact-form.spec.ts --watch=false` and `npm test -- --include=src/app/features/chat/chat-page.spec.ts --watch=false` from `frontend` | Browser execution is intentionally deferred; use the Angular TestBed DOM/keyboard harness as the runtime boundary and verify open, edit, close, retry, success, and duplicate scenarios | Remove the new form component/styles and child rendering from `chat-page.ts`/`chat-page.css`; retain the validated protocol client and backend endpoint |
| 4 | Complete privacy, compatibility, rollout documentation, static checks, and regression verification | Single PR, `size:exception` (internal unit 4) | `poetry run python -m pytest tests/test_contact.py tests/test_contact_delivery.py tests/test_api.py -q`; `poetry run ruff check app tests --output-format=concise`; `poetry run mypy app`; `npm run build` from `frontend` | Do not run Playwright during implementation; browser journey verification is a separate `sdd-verify` gate after browser installation | Revert only documentation, route-mock, and verification changes; preserve the independently gated implementation |

## Phase 1: Foundation / Contract Scaffolding

- [x] 1.1 Obtain maintainer approval for the required `size:exception` before implementation; record that the single-PR delivery strategy is intentionally retained despite the High forecast.
- [x] 1.2 Query the Angular workspace with `ng g @spartan-ng/cli:info --json` from `frontend`, then generate only the missing repository-owned Spartan Helm pieces for `field`, `input`, `textarea`, `alert`, and `spinner` under `frontend/src/app/shared/ui/`; preserve the existing import alias and semantic-token conventions.
- [x] 1.3 Create `backend/app/application/contact.py` with submission/form versions, exact field constants and limits, strict Pydantic request/response models, stable outcome categories, optional-company normalization to `null`, control-character rejection, conservative Spanish/English intent classification, and the lock-protected HMAC-only `EphemeralSubmissionGuard` with TTL, capacity, rate, processing, accepted, uncertain, release, and replay transitions.
- [x] 1.4 Create `backend/app/infrastructure/contact_delivery.py` with an injected standard-library HTTP transport for Resend, backend-only configuration validation, transient/permanent/timeout classification, and payload-free error metadata; never log or return request fields, provider bodies, provider IDs, or secrets.
- [x] 1.5 Add `backend/tests/test_contact.py` for exact schemas, unknown-field rejection, versions, requiredness, Unicode/length/control-character boundaries, optional-company normalization, classifier positive/ambiguous/refusal cases, one-suggestion eligibility, and every guard state including replay, concurrency, TTL expiry, bounded capacity, and rate limiting.
- [x] 1.6 Add `backend/tests/test_contact_delivery.py` using an injected fake transport to verify Resend request shape, secret header handling, timeout/transient/permanent classification, missing configuration, and discarded provider response content.

## Phase 2: Backend Integration and Chat Negotiation

- [x] 2.1 Modify `backend/app/application/chat.py` to validate the fixed server-owned `interview_contact_form` part with exact keys, versions, allow-listed intent, and field order, and append it only after ordinary validated parts; preserve all existing strict text, citation, sequence, and unsafe-content behavior.
- [x] 2.2 Modify `backend/app/application/chat_graph.py` to carry only non-PII contact intent/eligibility state, invoke the deterministic classifier for the current message, suppress suggestions for refusals, invalid responses, ambiguity, and repeated eligibility in one turn, and never carry form drafts or submitted values.
- [x] 2.3 Modify `backend/app/main.py` to advertise gated `interview_contact_form` and `contact_submission` capabilities in metadata, parse optional chat capabilities without breaking older request shapes, map the fixed form part into the v5 stream, and add `POST /api/v1/contact/submissions` with strict content type, 8 KiB body limit, UUID v4 `Idempotency-Key`, injected delivery/guard dependencies, safe HTTP outcome mapping, and metadata-only redacted observability.
- [x] 2.4 Add CORS support for the `Idempotency-Key` request header in `backend/app/main.py` without weakening the existing origin allow-list or exposing backend configuration to the browser.
- [x] 2.5 Update `backend/.env.example` with disabled-by-default feature gating, Resend key/sender/recipient, HMAC secret, and bounded rate/idempotency settings using placeholders only; update `backend/README.md` with backend-only secret ownership, single-process guard limitation, enablement order, and feature-gated rollback.
- [x] 2.6 Add integration coverage in `backend/tests/test_api.py` for metadata negotiation, eligible/ineligible/ambiguous intent, exact form-part ordering, text-only fallback, valid delivery, unknown/malformed/oversized input, unsupported versions, missing configuration, throttling, concurrent/replayed idempotency, stable provider failures, and no Resend call on rejected requests.
- [x] 2.7 Add privacy regression assertions in `backend/tests/test_api.py` proving contact values, idempotency keys, provider payloads/responses, secrets, and client identity do not appear in logs, responses, SSE, or chat graph state, and that contact submission does not invoke chat generation.

## Phase 3: Frontend Client and Inline Form

- [x] 3.1 Create `frontend/src/app/features/chat/contact-form.ts` with form/submission versions, allow-listed intent and field types, shared client limits, draft/state models, local validation, UUID idempotency-key creation/reuse, strict form-part validation, stable response parsing, and outcome mapping without storing values in chat telemetry.
- [x] 3.2 Modify `frontend/src/app/features/chat/chat-client.ts` to discover capability metadata, advertise only supported capabilities, strictly accept the fixed v5 form part, reject unsafe/unknown versions and extra keys, submit only the four declared fields plus submission version and idempotency header, map safe outcomes, and keep PII out of lifecycle logging and chat events.
- [x] 3.3 Create `frontend/src/app/features/chat/interview-contact-form.ts` as a standalone inline component with closed/suggestion, editing, submitting, success, duplicate, validation-error, retryable-failure, uncertain, and unavailable states; implement explicit confirmation/decline, draft preservation/discard, duplicate-submit prevention, first-invalid focus, heading focus on open, live status/error regions, consent copy, and no transcript/model continuation.
- [x] 3.4 Create `frontend/src/app/features/chat/interview-contact-form.css` with mobile-first grid layout, semantic Spartan colors, visible focus, responsive labels/errors, minimum 44px action targets, and no horizontal scrolling; use existing chat rhythm and no raw palette or unsafe HTML.
- [x] 3.5 Modify `frontend/src/app/features/chat/chat-page.ts` to render the child only for validated completed-turn form parts, preserve chronological text/source/form ordering, keep the suggestion closed and unfocused initially, retain composer behavior, and isolate local form outcomes from chat transcript state.
- [x] 3.6 Modify `frontend/src/app/features/chat/chat-page.css` only for required transcript spacing and responsive hooks; do not duplicate the form's component styling system.
- [x] 3.7 Add `frontend/src/app/features/chat/interview-contact-form.spec.ts` covering keyboard-only open/submit, labels and descriptions, decline, untouched close, dirty draft close/reopen/discard, local validation and first-invalid focus, loading deduplication, success, duplicate completion, retryable/uncertain recovery, unavailable failure, live announcements, no PII rendering, and narrow viewport action usability.
- [x] 3.8 Extend `frontend/src/app/features/chat/chat-client.spec.ts` for exact form-part parsing, unsafe/unknown rejection, capability fallback, declared submission payload/header, response mapping, idempotency reuse, payload-free telemetry, and preservation of existing strict chat validation cases.
- [x] 3.9 Extend `frontend/src/app/features/chat/chat-page.spec.ts` for completed-turn placement, no automatic form opening/focus, local lifecycle isolation, and unchanged text-only metadata behavior.

## Phase 4: Verification, Mocks, and Rollout Readiness

- [x] 4.1 Modify `frontend/e2e/support/chat-mocks.ts` with schema-only form-part and contact-endpoint mocks; do not place sample personal data in shared chat fixtures.
- [x] 4.2 Run the focused backend contract and delivery tests from `backend`: `poetry run python -m pytest tests/test_contact.py tests/test_contact_delivery.py -q`.
- [x] 4.3 Run the focused backend endpoint/privacy tests from `backend`: `poetry run python -m pytest tests/test_api.py -q`; confirm all existing strict chat cases named in the design still pass.
- [x] 4.4 Run the focused frontend client and component tests from `frontend`: `npm test -- --include=src/app/features/chat/chat-client.spec.ts --watch=false` and `npm test -- --include=src/app/features/chat/interview-contact-form.spec.ts --watch=false`.
- [x] 4.5 Run the focused frontend transcript tests from `frontend`: `npm test -- --include=src/app/features/chat/chat-page.spec.ts --watch=false`, then run `npm run build` to verify strict Angular compilation and component-style budgets.
- [x] 4.6 Run backend quality checks from `backend`: `poetry run ruff check app tests --output-format=concise`, `poetry run mypy app`, and `poetry check --lock`; do not add a Resend SDK or modify `backend/pyproject.toml`/`backend/poetry.lock` unless implementation evidence disproves the standard-library adapter decision.
- [x] 4.7 Confirm the disabled rollout harness: with `CONTACT_FORM_ENABLED=false`, metadata remains text-only, ordinary chat remains usable, and contact submission returns a safe non-success configuration outcome without provider invocation or PII diagnostics.
- [x] 4.8 Defer `frontend/e2e/portfolio-journeys.spec.ts` browser execution to explicit `sdd-verify`; if that gate is approved and browsers are installed, add one focused public journey for suggestion confirmation, valid submission, and a failure/recovery path, then run `npm run test:e2e` from `frontend`. Playwright execution is not implementation proof.
- [x] 4.9 Before apply completion, review the final diff against the 400-line policy, confirm the maintainer's `size:exception`, verify no application data migration exists, and document rollback as `CONTACT_FORM_ENABLED=false` first, followed by frontend/backend reversion if required.
