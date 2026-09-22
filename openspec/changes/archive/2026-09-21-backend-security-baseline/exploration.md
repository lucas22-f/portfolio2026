## Exploration: backend security baseline

### Current State
The portfolio exposes anonymous FastAPI chat streaming and a dedicated contact-submission endpoint. Chat requests already bound the message to 500 characters, use explicit provider limits (`gpt-5-mini`, input/output token caps, timeout, and projected/actual cost checks), and emit payload-free lifecycle diagnostics. The contact boundary uses strict Pydantic models, bounded fields/body size, HMAC-derived process-local idempotency/rate state, a five-attempt window default, and safe outcome categories. Contact delivery is backend-only and does not persist submissions.

There is no evidence of a general chat request-frequency or concurrency guard. The existing contact guard is process-local, so limits and idempotency state do not coordinate across replicas or restarts. Deployment configuration is lightweight (backend Dockerfile/Poetry project) with no demonstrated Redis, gateway, WAF, account, or authentication layer. Existing API/contact/provider tests provide focused seams for abuse-control behavior.

### Affected Areas
- `backend/app/main.py` — chat and contact HTTP boundaries, request parsing, response/status mapping, startup configuration, and safe observability.
- `backend/app/application/contact.py` — existing bounded contact validation and process-local HMAC idempotency/rate guard.
- `backend/app/infrastructure/chat_provider.py` — existing per-request token, timeout, and cost ceilings that should remain the primary cost control.
- `backend/tests/test_api.py` — endpoint behavior, payload-free logging, and contact replay coverage.
- `backend/tests/test_contact.py` — guard capacity, TTL, concurrency, and throttling coverage.
- `backend/tests/test_chat_provider.py` — provider limit and failure behavior coverage.
- `backend/Dockerfile`, `backend/pyproject.toml` — deployment/runtime constraints and dependency boundary; avoid adding infrastructure without evidence.
- `openspec/specs/contact-email-delivery/spec.md`, `openspec/specs/chat-interview-contact-form/spec.md` — existing privacy, validation, idempotency, and compatibility contracts that the baseline must preserve.

### Approaches
1. **In-process proportional baseline** — Add a small, bounded process-local guard for anonymous chat (short-window request/concurrency control), retain existing provider token/cost ceilings, and make contact limits/configuration explicit and tested. Add only proxy-aware identity handling if the deployment explicitly supplies trusted proxy headers.
   - Pros: Fits the current single-service architecture; low operational cost; directly reduces OpenAI request amplification and contact delivery abuse; no accounts or infrastructure.
   - Cons: Limits reset on restart and are per replica; not a complete distributed abuse solution.
   - Effort: Low

2. **Shared edge/infrastructure rate limiting** — Put chat/contact quotas in a managed gateway/WAF or Redis-backed limiter, with backend enforcement retained for correctness.
   - Pros: Coordinates replicas and survives application restarts; stronger burst control.
   - Cons: Adds cost, deployment coupling, secrets/operations, and failure modes unsupported by current evidence; likely disproportionate for this anonymous portfolio.
   - Effort: Medium/High

3. **Account or challenge-based protection** — Require login, CAPTCHA, or equivalent visitor verification before expensive chat/contact actions.
   - Pros: Stronger resistance to distributed anonymous abuse.
   - Cons: Damages the public portfolio's low-friction experience and introduces product/privacy complexity explicitly out of scope.
   - Effort: High

### Recommendation
Proceed with Approach 1. Treat existing provider ceilings as the cost-control foundation, add a bounded server-side chat admission guard covering request frequency and in-flight work, and preserve the existing contact HMAC/idempotency guard while documenting its single-process scope and safe defaults. Keep responses and logs category-only, reject malformed/oversized traffic before provider or delivery work, and add focused tests for chat throttling/concurrency, contact abuse boundaries, and configuration validation. Explicitly defer Redis, WAF, CAPTCHA, accounts, and frontend/mobile changes unless production evidence demonstrates that process-local controls are insufficient.

The proposal should resolve concrete default windows/capacities and the deployment's trusted-client-IP policy from current hosting facts, without changing the public API contract unnecessarily. If the service later runs multiple replicas or abuse crosses the baseline, that is the evidence threshold for a shared limiter.

### Risks
- Process-local controls do not provide a global quota across replicas or restarts and can be bypassed by distributed clients.
- Incorrect client identity extraction, especially trusting spoofable forwarding headers, could make throttling ineffective or unfair; use the transport's peer address unless trusted proxies are explicitly configured.
- Overly aggressive chat limits could reject legitimate portfolio visitors; defaults need bounded, user-visible retry semantics and focused tests.
- Streaming requests need explicit in-flight cleanup on completion, cancellation, and provider failure to avoid capacity leaks.
- Contact defaults already exist in code/specs; changing them can affect legitimate submissions and frontend retry behavior.

### Ready for Proposal
Yes. The proposal should define the minimal in-process chat admission guard, retain and clarify contact protections, preserve provider token/cost limits and privacy contracts, specify safe configuration and identity assumptions, and list distributed infrastructure, accounts/challenges, and mobile work as non-goals.
