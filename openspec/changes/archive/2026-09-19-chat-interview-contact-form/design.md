# Design: Chat Interview Contact Form

## Technical Approach

Extend the existing Angular/FastAPI boundary with two independent contracts:

1. The v5 chat SSE stream may contain one server-owned,
   schema-only `interview_contact_form` part. It is a suggestion, not an
   automatically opened form.
2. Angular submits the visitor's four fields to a dedicated versioned FastAPI
   endpoint. The submission never re-enters the chat graph, provider prompt, or
   SSE stream. FastAPI validates and rate-limits the request, applies a
   short-lived in-memory idempotency guard, and delegates delivery to an
   injected Resend adapter.

The current protocol version remains `5`, and the existing portfolio
`content_version` compatibility check remains unchanged. Contact-form and
submission versions are capability versions inside the v5 boundary. Older
clients do not advertise the capability, so the backend emits the existing
text-only event sequence for them. The implementation keeps the current strict
server-owned-part validation and the current `create_app` dependency-injection
pattern used by the backend tests.

The intent signal is deterministic and server-owned. A bounded Spanish
classifier evaluates the current chat message for high-confidence employment,
interview, or recruiting language. It returns one of three allow-listed intent
labels or no result; ambiguous language produces no suggestion. The classifier
does not call the model and does not add contact-form data to the model input.

## Architecture Decisions

### Decision: Preserve chat protocol v5 and negotiate the form as a capability

**Choice**: Keep `CHAT_PROTOCOL_VERSION = "5"` and add an optional frontend
capability advertisement to the chat request. The metadata endpoint advertises
`interview_contact_form: "1"` and `contact_submission: "1"` only when the
feature gate and delivery configuration are enabled. The new client sends the
capability only after seeing that advertisement; an older client sends the
existing request shape and receives no form part.

**Alternatives considered**: Bump the whole chat protocol to v6; always emit
the part and make old clients ignore unknown parts; or change
`content_version` for the feature.

**Rationale**: A protocol bump would unnecessarily disable otherwise compatible
text chat. Always emitting an unknown `part` conflicts with the current strict
validator and could make an old client reject a complete response. The content
version describes the reviewed portfolio bundle, not UI capabilities, so it
must not change for this feature.

### Decision: Use a fixed server-owned form schema

**Choice**: Emit only a fixed `interview_contact_form` part with form version
`"1"`, submission version `"1"`, an allow-listed intent, and the exact field
order `name`, `email`, `company`, `message`. Labels, copy, limits, and layout
remain client-owned and localized. No provider output can define fields,
labels, HTML, defaults, or prefilled values.

**Alternatives considered**: Let the model return a dynamic form definition;
send arbitrary field metadata from the server; or render the form from HTML in
the event.

**Rationale**: A fixed schema keeps the interactive surface auditable and
prevents executable or unexpected controls from crossing the SSE boundary. It
also makes the form contract stable for strict TypeScript and Pydantic
validation.

### Decision: Detect intent with a conservative server-side classifier

**Choice**: Add a pure classifier in `backend/app/application/contact.py`.
After Unicode normalization and lower-casing, it recognizes high-confidence
Spanish and English employment/interview/recruiting phrases such as
`entrevista`, `oportunidad laboral`, `contratar`, `reclutamiento`, `recruiter`,
and `recruiting`. It requires a positive contact intent phrase and returns one
intent label. It returns `None` for ambiguous or weak matches. A suggestion is
eligible only for a non-refusal, successfully validated chat response and at
most once per turn.

**Alternatives considered**: Ask the chat provider to return a second intent
field; use a separate model classifier; or infer eligibility in Angular.

**Rationale**: The existing provider contract is deliberately strict and
text-focused. A deterministic classifier avoids expanding provider schemas,
model prompts, token cost, and prompt-injection surface. Server ownership keeps
eligibility consistent across clients. The conservative false-negative bias is
safer than interrupting a conversation with an irrelevant form.

### Decision: Company is optional; name, email, and message are required

**Choice**: The client and server require `name`, `email`, and `message`.
`company` is optional and is transmitted as `null` when the visitor leaves it
blank. Whitespace-only company input becomes `null`; it is never replaced with
invented text. Both layers use the same declared bounds:

| Field | Contract | Limit and validation |
|---|---|---|
| `name` | Required string | Trimmed, 1–80 Unicode characters, no control characters or line breaks |
| `email` | Required string | Trimmed, 3–254 characters, one safe mailbox shape, no control characters or line breaks |
| `company` | Optional string or `null` | Trimmed, empty becomes `null`, at most 120 characters, no control characters or line breaks |
| `message` | Required string | Trimmed, 1–2,000 Unicode characters, no control characters |

The raw JSON body is capped at 8 KiB before delivery processing. The client
uses these constraints for early feedback, while Pydantic/application
validation remains authoritative.

**Alternatives considered**: Make company required because it is in the
essential field list; omit company from the request when blank; or accept
unbounded text and rely on Resend.

**Rationale**: The specification explicitly defines an omitted-company path,
and forcing a company would exclude independent visitors. Sending `null`
preserves the four-field contract without fabricating data. Tight bounds
prevent header injection, oversized requests, and accidental delivery of
unbounded content.

### Decision: Separate contact submission from chat transport

**Choice**: Add `POST /api/v1/contact/submissions` with body version
`submission_version: "1"` and the four declared fields. Require a UUID v4
`Idempotency-Key` header. Use strict `extra="forbid"` validation and stable
outcome codes. The endpoint never receives a chat message, request context, or
form part as a continuation token.

**Alternatives considered**: Add contact values to `/api/v1/chat/stream`; put
the form in a chat message; use `mailto:`; or add a database-backed submission
service.

**Rationale**: A separate boundary prevents PII from entering the model and
preserves the existing chat stream invariants. It also makes delivery,
idempotency, and anti-abuse behavior independently testable. No Supabase or
other persistence layer is introduced because persistence is explicitly out of
scope.

### Decision: Use an injected Resend HTTP adapter without a new SDK dependency

**Choice**: Implement `ResendContactDelivery` in
`backend/app/infrastructure/contact_delivery.py` using the same standard
library `urllib.request` transport style already used by
`chat_provider.py`. The adapter posts transient JSON to Resend's email API with
backend-only `RESEND_API_KEY`, `CONTACT_RECIPIENT_EMAIL`, and
`CONTACT_SENDER_EMAIL` settings. The recipient and sender are configured only
on the backend. Tests inject a fake transport/delivery implementation.

**Alternatives considered**: Add the Resend SDK; call Resend from Angular; or
send through an external form service.

**Rationale**: The repository already has a small, injectable HTTP adapter
pattern and does not need another runtime dependency. Backend-only delivery
keeps credentials and recipient configuration out of the browser. No
`pyproject.toml` or lockfile change is required unless implementation proves
that the standard-library adapter cannot satisfy the provider contract.

### Decision: Use bounded, non-persistent process-local protection

**Choice**: Add an `EphemeralSubmissionGuard` with a lock-protected TTL map.
It stores only bounded HMAC digests and status metadata, never raw contact
fields, email addresses, IP addresses, or request bodies. The default policy is
five attempts per derived client identity per ten minutes, a fifteen-minute
idempotency window, and a bounded maximum entry count. The guard states are:

- `processing`: concurrent replay returns `duplicate_processing` and does not
  call Resend;
- `accepted`: replay returns `duplicate_accepted` and does not call Resend;
- `uncertain`: a transport timeout/network ambiguity is retained and returns a
  retry-safe pending outcome without claiming delivery;
- known pre-accept transient failure: reservation is released so the same key
  may retry; permanent validation/configuration failures never reserve delivery.

The client reuses the same idempotency key during a request retry. It treats
`duplicate_accepted` as completion and `uncertain` as not delivered, with a
clear recovery message rather than a second automatic delivery.

**Alternatives considered**: Store submissions in Supabase; add Redis now; use
only a client-side disabled button; or allow every retry to create a new key.

**Rationale**: The current application has no shared ephemeral-store
dependency, and persistence is out of scope. Server-side protection is still
required because client controls are insufficient. The guard is behind an
interface so a shared TTL implementation can be introduced later without
changing the endpoint contract. Because process-local state does not coordinate
multiple workers, the rollout gate must remain disabled for multi-worker or
multi-replica deployment until a shared non-persistent guard is supplied.

### Decision: Keep observability metadata-only

**Choice**: Add contact lifecycle events containing only a generated request
correlation ID, outcome category, HTTP/provider status category, rate-limit
decision, elapsed time, and bounded counts. Do not log bodies, field values,
raw idempotency keys, client IPs, Resend response bodies/IDs, secrets, or
provider payloads. Frontend submission telemetry follows the existing
`logChatLifecycle` rule and records outcome/status only.

**Alternatives considered**: Log email addresses for support; include the
submission body in debug logs; or correlate it with the chat request ID.

**Rationale**: The proposal and specification make PII exclusion a hard
boundary. Operational categories are sufficient to diagnose availability,
validation, rate limiting, and delivery failures without turning logs or
traces into an inbox.

### Decision: Compose the form from existing Angular and Spartan patterns

**Choice**: Keep the inline, non-modal interaction in a focused standalone
`InterviewContactFormComponent`. Add the Spartan Helm `field`, `input`,
`textarea`, `alert`, and `spinner` components through the Angular CLI because
the current project has only button/card/badge/progress/separator copies. Use
native `<form>` semantics, `hlmField` labels/errors, `hlmBtn` variants, semantic
color tokens, and `gap-*` layout utilities. Do not introduce a dialog or a
parallel styling system.

**Alternatives considered**: Build a custom field system; use a modal dialog;
or add a generic form-builder abstraction.

**Rationale**: The existing chat is an inline transcript with a sticky
composer, so a modal would interrupt reading and complicate focus. Spartan's
Brain/Helm field composition supplies the established accessibility and visual
language. A small feature component avoids expanding `ChatPage` into another
stateful monolith.

## Data Flow

### Chat suggestion flow

```text
Angular metadata check
        │ capability contact-form=1
        ▼
Angular ChatClient ──POST /chat/stream──> FastAPI ChatRequest
                                             │
                                             ▼
                                  conservative intent classifier
                                             │ eligible + capability
                                             ▼
                         chat graph validates ordinary text parts
                                             │
                                             ▼
             v5 SSE start → text/tool/validated text+sources → form part → done
                                                                     │
                                                                     ▼
                                          Angular strict ChatClient validation
                                                                     │
                                                                     ▼
                                      closed suggestion (no focus/opening)
```

The form part is appended only after the ordinary server-owned response parts
have passed validation. It contains no visitor-entered value. If the feature is
disabled, the capability is absent and `build_event_stream` produces the
existing text-only sequence.

### Submission flow

```text
Visitor confirms suggestion
        │ local draft only in InterviewContactFormComponent
        ▼
client validation ──invalid──> first invalid field + no request
        │ valid
        ▼
POST /api/v1/contact/submissions
        │ strict schema + body limit
        ▼
normalization/validation → derived rate-limit key → idempotency reservation
        │                                           │ duplicate/blocked
        │                                           └──> stable safe outcome
        ▼
ResendContactDelivery (threadpool, transient payload only)
        │
        ├── accepted ──> mark accepted ──> accepted response
        ├── known transient failure ──> release reservation ──> retryable failure
        ├── timeout/ambiguous ──> mark uncertain ──> pending/uncertain response
        └── permanent/config failure ──> no local record ──> safe failure response
```

The form component never calls the chat stream after submission. A success,
duplicate, or failure message is local UI state and is not added to the chat
transcript or model context.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/app/application/contact.py` | Create | Fixed form/submission models, shared validation constants, conservative intent classifier, outcome types, and the bounded ephemeral guard interface/implementation. |
| `backend/app/application/chat.py` | Modify | Add the strict server-owned `InterviewContactFormPart` and append it only when the caller supplies an eligible intent and supported capability. Preserve existing text/citation validation. |
| `backend/app/application/chat_graph.py` | Modify | Carry only a non-PII `contact_intent`/eligibility result in graph state; never carry submission values or form drafts. |
| `backend/app/infrastructure/contact_delivery.py` | Create | Resend HTTP adapter, injected transport, secret validation, and provider error classification without logging payloads. |
| `backend/app/main.py` | Modify | Add metadata capability advertisement, optional chat capability parsing, the versioned contact route, CORS header support, body-size guard, injected delivery/ephemeral guard wiring, safe response mapping, and redacted contact observability. |
| `backend/.env.example` | Modify | Document feature gate, Resend key/sender/recipient, HMAC secret, and bounded rate/idempotency settings without real values. |
| `backend/README.md` | Modify | Document backend-only secret ownership, single-process guard limitation, enablement order, and safe rollback. |
| `backend/tests/test_contact.py` | Create | Unit coverage for exact schemas, field bounds, normalization, optional company, intent classification, form-part strictness, and ephemeral state transitions. |
| `backend/tests/test_contact_delivery.py` | Create | Resend adapter transport and status classification tests proving payload-free failure behavior and no secret leakage. |
| `backend/tests/test_api.py` | Modify | HTTP contract, capability negotiation, delivery outcomes, malformed/oversized input, rate limiting, duplicate/idempotency, configuration, and privacy-log regressions. |
| `frontend/src/app/features/chat/contact-form.ts` | Create | Form and submission versions, fixed field types, client constraints, draft/state model, response parser, and idempotency helpers. |
| `frontend/src/app/features/chat/interview-contact-form.ts` | Create | Standalone inline suggestion/form component with confirm/decline, editing, focus, accessible status, submission states, and Spartan field/button composition. |
| `frontend/src/app/features/chat/interview-contact-form.css` | Create | Responsive layout and state styling using existing semantic tokens and chat rhythm; no raw palette or unsafe HTML rendering. |
| `frontend/src/app/features/chat/chat-client.ts` | Modify | Validate the new fixed form part, negotiate capability metadata, submit the dedicated contract, map stable outcomes, and keep telemetry payload-free. |
| `frontend/src/app/features/chat/chat-page.ts` | Modify | Render the child form for validated completed turns without auto-opening it; preserve turn ordering and chat composer behavior. |
| `frontend/src/app/features/chat/chat-page.css` | Modify | Add only transcript spacing hooks needed by the inline form and preserve the current responsive/focus rules. |
| `frontend/src/app/features/chat/chat-client.spec.ts` | Modify | v5 form-part, unknown-version, capability-negotiation, submission request/response, and telemetry privacy tests. |
| `frontend/src/app/features/chat/interview-contact-form.spec.ts` | Create | Keyboard/focus, decline, local validation, loading deduplication, success, duplicate, retryable/uncertain failure, recovery, and no-PII-rendering tests. |
| `frontend/src/app/features/chat/chat-page.spec.ts` | Modify | Completed-turn placement, suggestion visibility, no automatic form focus, and text-only compatibility coverage. |
| `frontend/e2e/support/chat-mocks.ts` | Modify | Add a schema-only form-part mock and contact endpoint mock without putting sample PII into shared chat fixtures. |
| `frontend/e2e/portfolio-journeys.spec.ts` | Modify if browser verification is enabled | Add the focused form journey; Playwright remains deferred until explicit `sdd-verify`. |
| `frontend/src/app/shared/ui/{field,input,textarea,alert,spinner}/` | Create via Spartan CLI | Repository-owned Helm copies required by the form; use the project's Angular CLI workspace and existing `src/app/shared/ui` path. |
| `backend/pyproject.toml`, `backend/poetry.lock` | No change expected | The adapter uses the existing standard-library HTTP approach; add no Resend SDK unless implementation evidence requires it. |
| `backend/app/infrastructure/chat_provider.py` | No change expected | Intent is deterministic and server-side, so the strict provider schema and prompt boundary remain unchanged. |

## Interfaces / Contracts

### v5 form part

```typescript
export const CONTACT_FORM_VERSION = '1' as const;
export const CONTACT_SUBMISSION_VERSION = '1' as const;

export type ContactIntent = 'employment' | 'interview' | 'recruiting';
export const CONTACT_FIELDS = ['name', 'email', 'company', 'message'] as const;

export type InterviewContactFormPart = {
  type: 'interview_contact_form';
  form_version: typeof CONTACT_FORM_VERSION;
  submission_version: typeof CONTACT_SUBMISSION_VERSION;
  intent: ContactIntent;
  fields: typeof CONTACT_FIELDS;
};
```

The frontend validator requires the exact key set, exact versions, an
allow-listed intent, and the exact field array. Any unknown form version,
extra key, prefilled value, HTML, or arbitrary field definition causes the
strict stream to reject before interactive content is rendered. Capability
negotiation prevents old clients from receiving this part during normal
rollout.

### Submission request

```http
POST /api/v1/contact/submissions
Content-Type: application/json
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

```json
{
  "submission_version": "1",
  "name": "Visitor name",
  "email": "visitor@example.com",
  "company": null,
  "message": "I would like to discuss an interview."
}
```

The request model is strict and rejects unknown keys, missing required values,
invalid versions, malformed UUID headers, invalid content types, control
characters, and field/aggregate size violations before Resend is called.

### Submission response

Every response has a stable non-PII shape:

```typescript
type ContactOutcome =
  | 'accepted'
  | 'duplicate_accepted'
  | 'duplicate_processing'
  | 'delivery_uncertain'
  | 'validation_error'
  | 'unsupported_version'
  | 'idempotency_conflict'
  | 'throttled'
  | 'delivery_unavailable'
  | 'delivery_retryable'
  | 'delivery_failed';

type ContactSubmissionResponse = {
  outcome: ContactOutcome;
  retryable: boolean;
  request_id: string;
  field_errors?: Partial<Record<'name' | 'email' | 'company' | 'message', string>>;
};
```

`request_id` is generated by the backend for safe support correlation. Error
codes and field-error categories never echo submitted values. The frontend
maps outcomes to Spanish UI copy, while the server remains authoritative.

### HTTP outcome mapping

| HTTP | Outcome | Resend called | Client behavior |
|---:|---|---|---|
| 200 | `accepted` | Yes, accepted | Completed state; no submit action |
| 200 | `duplicate_accepted` | No | Completed/already received state |
| 202 | `duplicate_processing` | No | Processing state with bounded recovery message |
| 409 | `idempotency_conflict` | No | Edit/restart with a new explicit submission |
| 400 | `validation_error` | No | Field/form errors; preserve draft |
| 422 | `unsupported_version` | No | Safe unavailable-contract message; no retry loop |
| 429 | `throttled` | No | Retry later; preserve draft |
| 503 | `delivery_unavailable` or `delivery_uncertain` | No proven acceptance | Do not claim delivery; preserve draft and explain recovery |
| 502 | `delivery_retryable` or `delivery_failed` | Attempted | Retry only when the server classifies the failure as safe to retry |

### State and accessibility contract

The child component uses `closed`, `editing`, `submitting`, `success`,
`duplicate`, `validation-error`, `retryable-failure`, `uncertain`, and
`unavailable` states. Opening is the only action that changes `closed` to
`editing`; confirmation never focuses a field before the form is in the DOM.

- On open, focus the form heading (`tabindex="-1"`) and announce the context.
- On local/server validation failure, focus the first invalid field and expose
  field errors through `hlm-field-error` plus `aria-describedby`.
- During submission, disable submit and show `hlm-spinner`; one draft has one
  in-flight request.
- On success or `duplicate_accepted`, focus a non-PII status heading and keep
  the form non-submittable.
- On close with a dirty draft, collapse without submitting and expose
  `Continue editing` and `Discard draft`; untouched close simply stays closed.
- Use an inline `aria-live="polite"` status region and `role="alert"` only for
  actionable errors. Do not trap focus because this is not an overlay.
- Use mobile-first grid layout, semantic Spartan colors, visible focus, and
  minimum 44px action targets. No horizontal scrolling is permitted.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Backend unit | Field limits, control/newline rejection, optional company normalization, exact extra-field rejection | Direct Pydantic/application tests with boundary values and no delivery mock call |
| Backend unit | Conservative intent classifier and one-suggestion eligibility | Table-driven Spanish/English positive, ambiguous, refusal, and non-eligible messages |
| Backend unit | Form part schema and v5 event ordering | Assert exact keys, versions, fields, server-owned placement, and preservation of text-only streams |
| Backend unit | Resend adapter | Inject the existing-style HTTP transport; assert request shape, secret headers, transient/permanent/timeout classification, and discarded raw response data |
| Backend unit | Ephemeral guard | Test concurrent reservation, accepted replay, processing replay, uncertain timeout, TTL expiry, bounded capacity, HMAC-only state, and rate-limit behavior |
| Backend integration | Dedicated endpoint | `TestClient` with fake delivery and guard; cover valid delivery, malformed/oversized input, unsupported versions, duplicate replay, throttling, missing config, and stable status mapping |
| Backend integration | Privacy | Capture logs and assert no name/email/company/message, idempotency key, provider body, secret, or provider response appears; assert chat graph is not invoked by contact submission |
| Frontend unit | v5 form parsing and compatibility | Vitest tests for exact schema, unsafe/unknown form rejection, capability discovery, old metadata fallback, and strict existing text/citation validation |
| Frontend unit | Submission client | Mock `fetch`; assert only declared fields plus version are sent, `Idempotency-Key` is present, response categories map correctly, and logs contain metadata only |
| Frontend component | Lifecycle and accessibility | Angular TestBed + DOM keyboard interaction: confirmation/decline, draft preservation/discard, first-invalid focus, disabled loading action, success/duplicate/retry states, labels, descriptions, live regions, and touch-sized controls |
| Frontend integration | Chat transcript | Render a completed turn containing text/source/form parts; verify chronological placement, no form auto-open/focus, no PII in transcript, and old text-only metadata behavior |
| E2E (deferred) | Public journey | Extend existing route mocks for a focused form journey only when Playwright browser execution is explicitly requested by `sdd-verify`; do not treat configuration as proof |

Existing strict chat tests remain mandatory: sequence gaps, request mismatch,
terminal ordering, post-grounding preview rejection, HTML rejection for final
parts, and tool-after-preview behavior must continue to pass unchanged.

## Threat Matrix

The change adds an HTTP route and a browser-to-backend process boundary. The
specific matrix supplied by the SDD design skill covers executable/document
classification and VCS/PR automation, none of which is introduced here. Every
row is therefore explicitly `N/A`; HTTP threats are covered by the contracts,
validation, rate-limit, privacy, and endpoint tests above.

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A — no documentation or executable-file classification is changed | No path is classified or executed | None |
| Git repository selection | N/A — no Git command or repository selector is added | Repository remains the existing application workspace | None |
| Commit state | N/A — no staging or commit automation is added | No index/worktree behavior is changed | None |
| Push state | N/A — no push or refspec automation is added | No remote/ref resolution is performed | None |
| PR commands | N/A — no PR command composition is added | No VCS/PR subprocess is introduced | None |

HTTP-specific adversarial coverage is required separately: strict unknown-field
rejection, content-type/body limits, idempotency replay/concurrency, rate
limiting, secret/PII redaction, and unsupported-version fail-safe behavior.

## Migration / Rollout

No data migration is required. The feature has no persistent submission store.

1. **Scaffold disabled**: deploy backend code, route, validation, tests, and
   optional metadata fields with `CONTACT_FORM_ENABLED=false`. Existing v5
   clients continue to receive text-only SSE.
2. **Configure secrets**: set Resend API key, verified sender, recipient, and a
   dedicated HMAC secret only in Railway/backend configuration. Confirm the
   sender domain and endpoint with a non-production recipient where possible.
3. **Enable compatible backend**: enable the feature only on a single backend
   process (or after supplying a shared TTL guard). Confirm metadata advertises
   both capability versions and inspect only redacted outcome metrics.
4. **Deploy frontend**: the new client enables form capability only when
   metadata advertises it. If deployed before the backend, it remains a
   text-only client; if deployed after the backend, it can use the form.
5. **Verify**: exercise an eligible message, decline path, valid delivery,
   invalid draft, duplicate replay, rate limit, provider failure, and metadata
   fallback. Confirm no PII appears in logs, SSE, browser telemetry, or chat
   transcript.

Rollback is feature-gated and independent: set `CONTACT_FORM_ENABLED=false`
first, which stops new form parts while leaving text chat active; then roll back
the frontend if needed. If Resend configuration is unsafe, remove/disable the
backend secrets and keep the gate off. No contact data requires cleanup because
the guard is TTL-only and no local persistence is written. A multi-worker
deployment must not enable the feature until its guard implementation is
switched to a shared, non-persistent TTL backend.

## Open Questions

- None blocking the design. The only deployment prerequisite is operational:
  keep the feature disabled for multiple backend workers/replicas until a
  shared ephemeral guard is available.
