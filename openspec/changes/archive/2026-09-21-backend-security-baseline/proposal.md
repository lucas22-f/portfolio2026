# Proposal: Backend Security Baseline

## Intent

Reduce anonymous OpenAI chat-cost amplification and preserve the contact endpoint's existing privacy, validation, idempotency, and delivery protections. The baseline must fit the current single-service FastAPI deployment, remain process-local and bounded, and avoid adding infrastructure or friction that is not justified by current evidence.

## Scope

### In Scope

- Add a bounded in-process admission guard for anonymous chat before graph/provider work: 10 admissions per 60 seconds per transport peer, at most 2 in-flight streams per peer, and at most 32 in-flight streams per process.
- Use `request.client.host` as the client identity; do not trust `X-Forwarded-For` or similar headers because the current deployment exposes no trusted-proxy configuration.
- Return a stable retryable/throttled response with bounded retry guidance, keep lifecycle logs category-only, and release admission state on completion, cancellation, provider failure, and other stream exits.
- Keep the existing OpenAI model, token, timeout, projected-cost, and actual-cost ceilings unchanged and test that admission control runs before provider work.
- Preserve and clarify the contact guard's existing defaults and process-local HMAC-only scope (`5` attempts per `600` seconds, `900` second idempotency TTL, bounded capacity `2,000`), including configuration validation and abuse-boundary tests.

### Out of Scope

- Redis, shared/distributed rate limiting, gateway/WAF changes, CAPTCHA/Turnstile, accounts, login, or any other shared infrastructure.
- Frontend or mobile redesign, new authentication/challenge flows, contact persistence, or changing the contact fields and public contract.
- Changes to provider token/cost ceilings, model selection, chat content behavior, or the anonymous product flow beyond a small retryable response when admission control rejects a request.
- Trusting forwarded client-IP headers unless a future deployment explicitly supplies and documents a trusted proxy boundary.

## Capabilities

### New Capabilities

- `anonymous-chat-admission-control`: Bounded server-side frequency and concurrency admission for anonymous chat, with safe retry semantics, non-PII identity/state, cleanup guarantees, and process-local configuration.

### Modified Capabilities

- `contact-email-delivery`: Make the existing process-local HMAC rate/idempotency defaults, transport-peer identity assumption, bounded state, and fail-safe configuration semantics explicit while preserving the current validated, non-persistent delivery contract.

## Approach

Implement a small lock-protected in-process guard at the `/api/v1/chat/stream` HTTP boundary, before readiness/provider work and before creating the streaming graph task. Configure its defaults explicitly, bound identity state and expiry, and use the transport peer address only. Wrap the streaming generator so every terminal path releases in-flight capacity. Keep existing provider ceilings as the primary per-request cost control and retain contact validation, HMAC-derived idempotency, rate limiting, and non-PII diagnostics; strengthen tests around throttling, concurrency, cleanup, malformed traffic, configuration, and contact replay behavior. No new runtime dependency is needed.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/app/application/chat_admission.py` | New | Bounded process-local chat frequency/concurrency state and configuration validation. |
| `backend/app/main.py` | Modified | Apply chat admission before provider/graph work, expose safe retry behavior, and guarantee cleanup for streamed requests. |
| `backend/app/application/contact.py` | Modified | Preserve and document explicit contact guard defaults, bounded state, and process-local identity semantics. |
| `backend/tests/test_api.py` | Modified | Verify chat throttling, peer identity, retry response, admission ordering, and cleanup on stream outcomes. |
| `backend/tests/test_contact.py` | Modified | Verify contact defaults/configuration and existing rate/idempotency/concurrency boundaries remain intact. |
| `backend/tests/test_chat_provider.py` | Modified | Regression coverage proving provider token, timeout, and cost ceilings remain unchanged. |
| `openspec/specs/contact-email-delivery/spec.md` | Delta | Record the clarified contact abuse-control and process-scope contract during the spec phase. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Process-local limits do not coordinate across replicas or restarts. | Med | Document the boundary and defer shared limiting until deployment evidence shows it is required. |
| Peer-address throttling may be shared by NAT users or bypassed by distributed clients. | Med | Use conservative defaults, keep provider ceilings, and record category-only metrics for later tuning. |
| In-flight capacity could leak on cancellation or provider failure. | Med | Use one cleanup path/finally guarantee and test normal, cancelled, failed, and streaming exits. |
| Chat limits could reject legitimate rapid follow-up questions. | Low/Med | Start with 10 per minute and two concurrent streams per peer, return retryable guidance, and avoid changing ordinary successful chat behavior. |
| Contact default changes could affect legitimate submissions. | Low | Preserve the current `5/600s`, `900s`, and `2,000` defaults and add regression tests before any tuning. |

## Rollback Plan

Revert the chat admission module, its `main.py` wiring, configuration, tests, and the contact-spec clarification. The existing provider ceilings, contact validation, HMAC idempotency/rate guard, delivery adapter, and public contact contract remain independently usable, so rollback does not require data migration or infrastructure changes.

## Dependencies

- Existing FastAPI request boundary, asyncio streaming lifecycle, and pytest seams.
- No new runtime dependency or shared service.
- Deployment must continue to expose a usable transport peer address; forwarded headers remain untrusted by default.

## Success Criteria

- [ ] A single peer cannot start more than 10 chat streams in a 60-second window or exceed 2 concurrent streams; the process cannot exceed 32 concurrent streams.
- [ ] Throttled requests are rejected before provider/retriever work with a stable retryable outcome and no request payload in logs or responses.
- [ ] Admission state is released on success, cancellation, provider failure, and internal failure, with bounded expiry/capacity and no PII.
- [ ] Existing provider token, timeout, projected-cost, actual-cost, contact validation, idempotency, privacy, and delivery tests remain green.
- [ ] Contact protection retains the current defaults and process-local scope, and the proposal introduces no Redis, WAF, CAPTCHA, account, frontend, or mobile dependency.
