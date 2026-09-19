## Exploration: chat-interview-contact-form

### Current State
The portfolio chat is an Angular standalone `ChatPage` backed by a strict v5 SSE contract. `ChatClient` validates event ordering, request identity, protocol/content versions, text parts, grounding, citations, terminal outcomes, and usage before `ChatPage` renders server-owned parts. The page currently renders only text and source parts; the composer is an ordinary `FormsModule` textarea with Spartan `hlmBtn` controls.

On the backend, `POST /api/v1/chat/stream` creates a LangGraph flow. The provider returns validated candidate mappings, optionally requests portfolio retrieval, and may stream untrusted text previews. `validate_output` accepts only the current text candidate shape and appends server-owned PDF citations. `build_event_stream` emits `start`, optional `tool`, `part` events, terminal refusal/error, and `done`. The OpenAI provider uses a structured JSON schema and Spanish instructions, while tests cover provider schema construction, SSE reconstruction, validation failures, API event sequences, Angular state transitions, accessibility, and Playwright route mocks.

There is no existing contact submission endpoint, persistence adapter, email provider, database, anti-spam mechanism, or form-specific design component in the inspected code. The backend dependency set is FastAPI/Pydantic-oriented and contains no email, database, or third-party delivery client. The frontend already has Spartan Brain/Helm installed and uses `HlmButtonImports`; form controls are otherwise native markup with Tailwind classes. The project’s declared test capabilities are Angular/Vitest unit tests, pytest API/application/provider tests, and configured-but-unproven Playwright E2E.

### Affected Areas
- `frontend/src/app/features/chat/chat-client.ts` — extend the discriminated event/part contract and strict client validation if the server can request an inline form.
- `frontend/src/app/features/chat/chat-page.ts` — render the form as a conversation part, manage draft/submission state, focus, disabled and success/error states, and preserve completed-turn ordering.
- `frontend/src/app/features/chat/chat-page.css` — provide responsive, accessible form layout and state styling consistent with the existing chat rhythm.
- `backend/app/application/chat.py` — define and validate a server-owned form part; keep provider output from controlling arbitrary fields or markup.
- `backend/app/application/chat_graph.py` — decide how interview intent is detected and how a form request is represented in graph state and final parts.
- `backend/app/infrastructure/chat_provider.py` — update the provider structured schema/instructions only if intent/form output is model-selected; preserve strict validation and retry behavior.
- `backend/app/main.py` — add either a submission route or a server-side submission continuation, plus rate limiting/observability boundaries.
- `backend/tests/test_application_chat.py`, `backend/tests/test_chat_provider.py`, `backend/tests/test_api.py` — cover intent classification, schema rejection, SSE ordering, submission validation, and delivery failures.
- `frontend/src/app/features/chat/chat-client.spec.ts`, `frontend/src/app/features/chat/chat-page.spec.ts` — cover part parsing, safe rendering, keyboard/accessibility behavior, duplicate-submit prevention, and terminal state handling.
- `frontend/e2e/support/chat-mocks.ts` and relevant Playwright specs — mock the new stream/submission contracts if an E2E journey is added.
- `openspec/config.yaml` — existing rules require preserving the frontend/backend boundary, documenting data contracts, and using Given/When/Then in later specs.

### Approaches
1. **Validated inline form part plus dedicated submission endpoint** — the chat response emits a server-owned `interview_contact_form` part containing only a versioned field definition/configuration; Angular renders it with native controls composed with Spartan field/button primitives, then submits to a dedicated FastAPI endpoint.
   - Pros: clean separation between conversation generation and PII submission; form remains inline and resumable; endpoint can validate, rate-limit, redact logs, and retry delivery independently; provider cannot emit HTML or executable UI.
   - Cons: requires a second HTTP contract and lifecycle model; needs a durable idempotency strategy; intent detection and form eligibility must be specified carefully.
   - Effort: Medium/High

2. **Submit the form as a chat SSE command/continuation** — the form part includes a conversation action, and the frontend sends the completed fields through the chat API, which persists/delivers them during a graph continuation.
   - Pros: one conversational surface and potentially one request model; can preserve context for the assistant’s confirmation.
   - Cons: couples PII handling to the model/SSE graph; complicates replay, cancellation, SSE terminal semantics, and idempotency; increases the risk that sensitive fields enter provider prompts or logs; requires more substantial protocol changes.
   - Effort: High

3. **Client-only mailto or external form handoff** — render an inline form but hand delivery to a `mailto:` URL or third-party form service.
   - Pros: little backend work and no local persistence schema.
   - Cons: unreliable browser-dependent delivery, poor privacy/control, weak spam protection, and an inconsistent experience; third-party processing and credentials/compliance need explicit approval.
   - Effort: Low/Medium

### Recommendation
Carry forward Approach 1 for proposal/design: keep the chat stream responsible for a strictly validated, server-owned form request and use a separate submission endpoint for PII, validation, rate limiting, idempotency, storage, and delivery. Reuse Spartan’s existing field/button primitives rather than inventing a parallel form system, and preserve Angular’s interpolation-only rendering and the current server-owned-part model. This is an architectural recommendation, not a product decision: the orchestrator must obtain decisions on the actual fields, consent copy, retention, recipient, and delivery policy before specification.

The next design should define a versioned form part and submission contract, intent-detection authority (model classification versus deterministic trigger/rules), whether the form is emitted once per conversation, and the confirmation/error behavior. It should also explicitly decide whether the initial slice stores submissions, delivers them directly, or uses both; the repository currently provides none of these capabilities.

### Risks
- Model-selected interview intent can be a false positive or false negative; the product must define whether an explicit user request, confidence threshold, or confirmation step is required.
- Contact details are personal data. Logging, provider prompts, persistence, retention, consent, access, and deletion need a concrete policy before implementation.
- A streamed form part changes protocol versioning and compatibility checks; old clients must fail safely rather than render unknown interactive content.
- Duplicate submissions can arise from retries, refreshes, network ambiguity, or repeated chat actions; an idempotency key and user-visible submission state are required.
- Delivery providers can fail after accepting a submission, creating a need for durable status, retry policy, and an operator-visible failure path.
- Spam, abuse, oversized payloads, malformed URLs, and automated submissions require server-side limits and throttling; client validation is insufficient.
- Inline interactive content affects transcript semantics, focus order, mobile layout, screen-reader announcements, and whether completed forms remain editable.
- Adding a new provider/database/email dependency expands deployment configuration and testing beyond the currently proved stack.

### Ready for Proposal
Yes, after the orchestrator presents unresolved product decisions rather than assuming them. Required decisions are: exact fields (for example name, email, company, role, message, preferred contact method), whether phone/URL are needed, consent and privacy copy, recipient(s), storage/retention/deletion policy, delivery mechanism, whether Lucas needs an admin inbox/dashboard or only email, duplicate/confirmation behavior, anti-spam requirements, and whether the form should appear only after an explicit interview request or also after inferred intent. The proposal can proceed with Approach 1 as the technical direction while recording these as approval gates.
