# Chat Endpoint Security and Budget

## Objective
Protect the public chat endpoint from direct unauthenticated backend calls, then enforce the accepted shared monthly spend policy of a USD 3 warning and USD 5 hard cap.

## Problem and Why
The Angular client currently calls the public FastAPI endpoint directly. The route has anonymous process-local throttling, but no server-to-server authentication or shared global spending cap. A browser-embedded shared secret would be public, so chat traffic must pass through a server-side Vercel function before the backend accepts it.

## Scope
- Secure only the chat streaming endpoint through a Vercel server-side proxy and backend service-token verification.
- Keep the existing chat SSE protocol and local development workflow functional.
- After endpoint authentication is implemented and verified, add a durable cross-instance USD 5 monthly spend cap and a one-time-per-period USD 3 structured warning.
- Use the existing Supabase Postgres connection for shared budget state if implementation inspection confirms the existing connection is suitable.
- Do not change contact submission authentication, add user accounts, deploy remotely, or expose service credentials to the Angular bundle.

## Constraints
- User-directed order: endpoint security first; budget limits second.
- Never trust browser-supplied Origin, Referer, or forwarded-IP headers as authentication.
- Keep the Vercel-to-backend service token server-side and fail closed when production secrets are missing.
- A public proxy still requires the later budget guard; service-token authentication alone does not identify or authenticate visitors.
- Global budget accounting must be atomic/shared across backend instances, use UTC calendar months, and reserve funds before provider calls so concurrent requests cannot overspend the cap.
- The USD 3 warning is a structured backend log once per month; no external alert delivery is in scope.
- No live Vercel, Render, or Supabase configuration or migration execution without explicit remote-operation authorization.
- Effective TDD: strict TDD is ON (Engram `sdd-init/portfolio2026`). Frontend runner: `npm run test:unit -- --include=<spec-path>` from `frontend/`. Backend runner: `poetry run pytest <test-path>` from `backend/`.
- Chosen route: delegated direct, one bounded writer per work unit. Trigger evidence: each cross-layer unit touches multiple non-trivial files (Angular client/Vercel function/FastAPI auth; later SQL migration/shared budget store/provider lifecycle/tests).
- Delivery strategy: `ask-on-risk`; forecast is approximately 300 authored changed lines, to be revised after each work unit. If the accumulated feature approaches 400 authored changed lines, stop before the next commit and follow that strategy.

## Authorized Scope
- `frontend/src/app/features/chat/chat-client.ts`
- Root-level Vercel function under `api/` and related Vercel configuration/documentation as required.
- `backend/app/main.py`, focused backend auth/provider/application modules, and tests.
- `backend/supabase/migrations/` plus a shared budget persistence module and tests for the second work unit.
- `render.yaml` and safe example/config documentation for required environment variable names only; never add secret values.
- This task document and its Engram mirror at `odd/chat-endpoint-security-budget/tasks`.

## Tasks

### CHAT-SEC-01 — Authenticate the chat endpoint through Vercel
- [x] Add a same-origin Vercel server-side SSE proxy that forwards the chat request and stream without buffering.
- [x] Require a server-only shared service token at the proxy and validate it in FastAPI before chat admission.
- [x] Ensure production fails closed when the shared token is missing; keep tests and local development explicit and safe.
- [x] Add regression tests for missing/invalid/valid service authorization and frontend routing through the proxy.
- [x] Document the two environment variable locations/names and the manual deployment configuration needed; never write actual secrets.
- Route: delegated direct. Verification: focused backend API tests and focused frontend chat-client tests.
- Rollback boundary: remove the proxy/auth header path and restore the previous direct client route; no unrelated chat behavior changes.

### CHAT-BUDGET-02 — Enforce shared monthly spend budget
- [ ] Add a dedicated Supabase Postgres monthly usage ledger and atomic reserve/settle/release operations, using a migration that is not applied remotely by this task.
- [ ] Estimate per-request cost using configured model token prices; reserve a request ceiling before provider work and settle from provider-reported aggregate usage afterward.
- [ ] Emit one structured warning when monthly spend reaches USD 3; deny new reservations once spend plus reservations reaches USD 5.
- [ ] Fail closed for chat generation if the shared budget store is unavailable or a reservation outcome is unknown.
- [ ] Test concurrency, cap boundary, warning-once, UTC month rollover, provider failure/cancellation, and settlement behavior.
- Route: delegated direct. Verification: focused backend budget/API tests.
- Rollback boundary: remove the monthly ledger and budget admission only; keep CHAT-SEC-01 service authentication intact.

## Acceptance Criteria
- Direct requests to FastAPI `/api/v1/chat/stream` without the service token are rejected before provider work.
- The browser never receives or stores the service token; it calls the same-origin Vercel route.
- Vercel transparently preserves the existing SSE stream and aborts upstream work if the browser disconnects where supported by the function runtime.
- The local developer chat path is documented and remains explicit; no silent production bypass exists.
- All chat provider work is covered by an atomic shared monthly reservation/settlement; concurrent requests cannot exceed USD 5 based on configured rates and the reserved maximum.
- USD 3 emits a single monthly structured warning; USD 5 blocks additional provider work.
- User-owned RDD remains off unless explicitly enabled. Run functional tests and do not invoke native review while it is off.

## Progress and Evidence
- Initial repository state: clean on `main` at `2104eb8` before feature branch creation.
- Active local feature branch: `feat/chat-endpoint-security-budget`.
- Deployment map: Vercel serves Angular static output and Render deploys FastAPI; Supabase Postgres is the existing shared database. No remote services inspected.
- Task document and Engram mirror are synchronized.
- `CHAT-SEC-01`: complete. Verification: `poetry run pytest tests/test_api.py` (22 passed); `npm run test:unit -- --include=src/app/features/chat/chat-client.spec.ts` (26 passed); `node --test api/v1/chat/stream.test.js` (3 passed); `git diff --check` passed. Independent security verification passed after updating the README smoke flow.
- Native risk assessment could not classify while the ODD task document was untracked; independent verification was performed. RDD remains off.
- `CHAT-BUDGET-02`: pending.

## Next Step
Implement `CHAT-BUDGET-02`; do not configure Render or Vercel secrets or apply Supabase migrations remotely without explicit authorization.
