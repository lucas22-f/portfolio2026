# Proposal: Chat Interview Contact Form

## Intent

Give visitors who express employment or interview interest a low-friction way to contact Lucas without leaving the chat. The assistant will suggest an inline contact form, while the visitor explicitly confirms and opens it; submission will be validated server-side and delivered by email without persisting the message or exposing personal data to the model, SSE telemetry, or logs.

## Scope

### In Scope

- Add a strictly validated, server-owned inline interview/contact form part to the chat protocol.
- Suggest the form when interview or employment intent is detected, requiring visitor confirmation before rendering or interrupting the conversation.
- Collect only name, email, company, and message, with accessible responsive states for editing, submission, success, validation failure, and delivery failure.
- Add a dedicated FastAPI submission boundary that validates input, applies proportionate anti-abuse and duplicate/idempotency handling, and calls Resend directly.
- Keep Resend credentials and recipient/sender configuration in backend secrets and ensure submitted PII does not enter model prompts, SSE events, observability, or application logs.
- Add focused frontend/backend contract, validation, delivery, failure-recovery, and accessibility coverage.

### Out of Scope

- Persisting contact submissions, building a database-backed inbox, or adding an admin dashboard.
- A mandatory consent checkbox; consent will be communicated in the submit action and supporting copy.
- Client-only `mailto:` delivery, an external form service, or routing PII through the chat model/SSE continuation.
- Rich CRM workflows, attachments, phone/URL fields, bulk messaging, or general-purpose form-builder infrastructure.

## Capabilities

### New Capabilities

- `chat-interview-contact-form`: Server-owned inline interview/contact form suggestions, rendering, validation, submission states, and accessible visitor interaction within the chat.
- `contact-email-delivery`: Dedicated FastAPI contact submission handling with validation, anti-abuse and duplicate protection, non-persistent processing, and Resend email delivery.

### Modified Capabilities

- None. No existing OpenSpec capability specs are present; the current chat behavior will be extended by the new capability contract.

## Approach

Use the recommended architecture of a versioned `interview_contact_form` chat part plus a separate submission endpoint. The stream may carry only server-validated form configuration and intent metadata; Angular renders native controls using the existing Spartan field/button primitives and interpolation-only binding. Submission values go directly to FastAPI, which validates and limits the request, performs short-lived non-PII duplicate/idempotency handling, and calls Resend. The implementation will preserve existing server-owned-part validation, protocol compatibility, conversation ordering, and safe failure behavior.

Intent detection and eligibility will remain server-controlled and will produce a suggestion rather than an automatic interruption. The design phase will define the exact versioned contracts, detection threshold/authority, request-token lifecycle, rate-limit strategy, and Resend failure semantics without expanding the product scope.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `frontend/src/app/features/chat/chat-client.ts` | Modified | Validate the new versioned form part and submission responses while rejecting unknown or unsafe interactive content. |
| `frontend/src/app/features/chat/chat-page.ts` | Modified | Render the confirmed form, manage draft/submission state, focus, accessibility announcements, duplicate-submit prevention, and completed-turn ordering. |
| `frontend/src/app/features/chat/chat-page.css` | Modified | Add responsive form layout and accessible validation, loading, success, and failure styling consistent with the chat rhythm. |
| `backend/app/application/chat.py` | Modified | Define and validate the server-owned form part without allowing provider output to control arbitrary fields or markup. |
| `backend/app/application/chat_graph.py` | Modified | Detect eligible interview intent and represent a confirmed-suggestion-capable form request in graph state/output. |
| `backend/app/infrastructure/chat_provider.py` | Modified | Update structured output/instructions only as needed for validated intent signaling; keep PII outside provider inputs. |
| `backend/app/main.py` | Modified | Expose the dedicated submission boundary, validation, anti-abuse controls, delivery invocation, and redacted observability. |
| `backend/pyproject.toml` and lockfile | Modified | Add the Resend client dependency only if the implementation cannot use a minimal existing HTTP stack. |
| `backend/tests/` and `frontend/src/app/features/chat/*.spec.ts` | Modified | Cover contracts, validation, intent behavior, duplicate handling, delivery failures, accessibility, and safe rendering. |
| `frontend/e2e/` | Modified | Extend route mocks and add a focused journey if Playwright verification is explicitly run. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| False-positive or false-negative interview intent creates an irrelevant or missed suggestion. | Med | Keep detection server-controlled, require visitor confirmation, constrain the form to eligible turns, and test explicit and inferred intent cases. |
| Contact PII leaks through model inputs, SSE events, logs, or telemetry. | Med | Use a separate submission boundary, keep form parts schema-only, redact observability, and add regression tests for data-flow boundaries. |
| Resend rejects or times out after a submission. | Med | Provide explicit pending/success/failure states, prevent unsafe retries, use idempotency/duplicate handling, and define a user-visible recovery path. |
| Automated abuse or oversized/malformed requests consume delivery quota. | Med | Enforce server-side length and format limits, request throttling, origin-aware safeguards where appropriate, and bounded duplicate protection. |
| Protocol changes break older clients or allow unsafe interactive content. | Low/Med | Version the part, preserve strict client validation, fail safely on unsupported content, and cover SSE ordering and compatibility tests. |

## Rollback Plan

Disable form emission behind the server-side eligibility/feature gate and leave the existing text-only chat path active. If necessary, remove the submission route and Resend configuration, then revert the versioned chat contract and associated frontend rendering/tests; no persisted submissions or migration rollback is required because the feature stores no contact data.

## Dependencies

- A Resend account and verified sender configuration, with API key, recipient, and sender values supplied only as backend deployment secrets.
- The existing FastAPI, Angular, SSE, and Spartan foundations.
- A deployment-compatible short-lived mechanism for non-PII rate-limit and duplicate/idempotency state; it must not become a submission store.

## Success Criteria

- [ ] Visitors expressing interview or employment interest receive a clear form suggestion and must explicitly open it; the chat is never automatically interrupted.
- [ ] The form collects only name, email, company, and message, provides accessible validation and state feedback, and communicates consent without a mandatory checkbox.
- [ ] Valid submissions reach the configured recipient through Resend, while invalid, duplicated, throttled, and delivery-failed requests produce safe, recoverable outcomes.
- [ ] No submitted PII is included in model prompts, streamed events, application logs, or standard observability payloads, and no submission is persisted.
- [ ] Frontend and backend automated tests cover the new contracts, data boundaries, accessibility-critical states, duplicate-submit behavior, and Resend failure handling.
