# Chat Endpoint Security and Budget

## Objective
Protect the public chat endpoint from direct unauthenticated backend calls, then enforce the accepted shared monthly spend policy of a USD 3 warning and USD 5 hard cap.

## Problem and Why
The Angular client currently calls the public FastAPI endpoint directly. The route has anonymous process-local throttling, but no server-to-server authentication or shared global spending cap. A browser-embedded shared secret would be public, so chat traffic must pass through a server-side Vercel function before the backend accepts it.

## Scope
- Secure only the chat streaming endpoint through a Vercel server-side proxy and backend service-token verification.
- Restrict the existing Supabase PDF tables to backend-only access, per the user's confirmed policy; do not add `anon`/`authenticated` read policies.
- Keep the existing chat SSE protocol and local development workflow functional.
- After endpoint authentication is implemented and verified, add a durable cross-instance USD 5 monthly spend cap and a one-time-per-period USD 3 structured warning.
- Use the existing Supabase Postgres connection for shared budget state if implementation inspection confirms the existing connection is suitable.
- Do not change contact submission authentication, add user accounts, or expose service credentials to the Angular bundle. The only authorized production targets are the supplied Vercel project, Supabase project, and Render service, using the user's session.

## Constraints
- User-directed order: endpoint security first; budget limits second.
- Never trust browser-supplied Origin, Referer, or forwarded-IP headers as authentication.
- Keep the Vercel-to-backend service token server-side and fail closed when production secrets are missing.
- A public proxy still requires the later budget guard; service-token authentication alone does not identify or authenticate visitors.
- Global budget accounting must be atomic/shared across backend instances, use UTC calendar months, and reserve funds before provider calls so concurrent requests cannot overspend the cap.
- The USD 3 warning is a structured backend log once per month; no external alert delivery is in scope.
- The confirmed RLS policy for existing PDF tables is backend-only; public client roles are denied.
- If provider usage cannot be confirmed after timeout/cancellation, retain the worst-case reservation for the remainder of that UTC month rather than assuming the upstream incurred no cost; this intentionally favors the hard cap over availability.
- Cost rates default to current `gpt-5-mini` rates and must be configured to match `OPENAI_MODEL` when the model is overridden.
- No live Vercel, Render, or Supabase configuration or migration execution without explicit remote-operation authorization.
- Effective TDD: strict TDD is ON (Engram `sdd-init/portfolio2026`). Frontend runner: `npm run test:unit -- --include=<spec-path>` from `frontend/`. Backend runner: `poetry run pytest <test-path>` from `backend/`.
- Chosen route: delegated direct, one bounded writer per work unit. Trigger evidence: each cross-layer unit touches multiple non-trivial files (Angular client/Vercel function/FastAPI auth; later SQL migration/shared budget store/provider lifecycle/tests).
- Delivery strategy: `ask-on-risk`. Security work unit `0186e90` contains 517 authored changed lines (456 additions, 61 deletions), exceeding the 400-line planning threshold. User selected `stacked-to-main` before the next commit: each PR merges to `main` in order. No PR was created.

## Authorized Scope
- `frontend/src/app/features/chat/chat-client.ts`
- Root-level Vercel function under `api/` and related Vercel configuration/documentation as required.
- `backend/app/main.py`, focused backend auth/provider/application modules, and tests.
- `backend/supabase/migrations/` for the budget ledger and backend-only PDF table RLS, plus focused tests.
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

### CHAT-SEC-02 — Restrict PDF tables to backend-only access
- [x] Add a versioned migration enabling RLS on `app.pdf_versions` and `app.pdf_chunks`, denying `PUBLIC`/`anon`/`authenticated`, and permitting backend roles.
- [x] Add migration-contract coverage; the focused test and independent source review passed.
- [x] Apply migration `pdf_tables_backend_only_rls` to the specified Supabase project; readback confirms both PDF tables have RLS enabled and a `service_role` policy.
- Route: delegated direct for code/test work, followed by user-authorized Supabase migration execution.
- Rollback boundary: revert only the PDF-table RLS/grants migration; retain chat endpoint auth and budget code.

### CHAT-SEC-03 — Enable RLS for the monthly budget ledger
- [x] User confirmed backend-only access and authorized RLS on `app.chat_budget_months` and `app.chat_budget_reservations`, preserving backend RPC access.
- [x] Add a versioned migration enabling RLS without `FORCE ROW LEVEL SECURITY` or direct-access policies/grants; add contract coverage that existing security-definer RPCs and service-role grants remain intact.
- [x] Document the migration order and backend-only access model.
- [x] Apply migration `chat_budget_ledger_rls` to the specified Supabase project (version `20261002151729`); readback confirms RLS enabled, FORCE RLS off, and no anon/authenticated table SELECT grants.
- [x] Verify all four budget RPCs remain `SECURITY DEFINER`, executable by `service_role`, and not executable by `anon` or `authenticated`.
- Status: direct PUBLIC/anon/authenticated privileges are revoked; budget writes use service-role-only security-definer RPCs.

### CHAT-BUDGET-02 — Enforce shared monthly spend budget
- [x] Add a dedicated Supabase Postgres monthly usage ledger with transaction-safe, idempotent reserve/settle/release operations and service-role-only access; migration `chat_monthly_budget` is applied.
- [x] Estimate per-turn cost using configured model token prices; reserve a conservative request ceiling before provider work and settle from cumulative provider-reported input/output usage afterward.
- [x] Emit one structured warning log when settled monthly spend first reaches USD 3; deny new reservations once spend plus outstanding reservations reaches USD 5.
- [x] Fail closed for chat generation if the shared budget store is unavailable or a reservation outcome is unknown.
- [x] Add focused tests for cap boundary, in-memory concurrent reservations, warning-once, UTC rollover, idempotent settlement, provider failure/cancellation, and migration lock/privilege contract.
- [ ] Execute SQL concurrency/permission tests against a disposable local PostgreSQL instance; unavailable in this session. Production migrations were applied and read back separately.
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
- Deployment map: Vercel serves Angular static output and Render deploys FastAPI; Supabase Postgres is the existing shared database. The user authorized production reads/migrations and rollout to the specified targets.
- Task document and Engram mirror are synchronized.
- `CHAT-SEC-01`: complete in commit `0186e90` (`feat(chat): secure streaming through Vercel proxy`). Verification: `poetry run pytest tests/test_api.py` (22 passed); `npm run test:unit -- --include=src/app/features/chat/chat-client.spec.ts` (26 passed); `node --test api/v1/chat/stream.test.js` (3 passed); `git diff --check` passed. Independent security verification passed after updating the README smoke flow.
- Native risk assessment could not classify while the ODD task document was untracked; independent verification was performed. RDD remains off.
- User authorized production rollout to the specified Vercel, Supabase, and Render targets using their session.
- Supabase flagged existing `app.pdf_versions` and `app.pdf_chunks` tables with RLS disabled. User confirmed only backend roles may access them; backend-only RLS is now enabled on both tables.
- `CHAT-SEC-02`: local migration and contract test committed as `a05ca58` (`fix(security): restrict Supabase PDF access to backend`). Focused test and independent source review passed; Supabase migration version `20261002143856` applied, with RLS and `service_role` policies verified by readback.
- User selected `stacked-to-main` after the 400-line threshold was exceeded; no PR was created. `CHAT-BUDGET-02` is committed locally as `6490442` (`feat(chat): enforce shared monthly spend budget`); the branch has not been pushed.
- Production migration versions applied: `chat_monthly_budget` (`20261002143537`) and `pdf_tables_backend_only_rls` (`20261002143856`). Vercel project and Render service read access also succeeded. No Vercel/Render environment changes or deployments have been performed.
- `CHAT-SEC-03`: migration `202610020002_chat_budget_ledger_rls.sql`, contract test, and README migration instructions committed as `61ff486` (`fix(security): enable RLS on chat budget ledger`). RED/GREEN test cycle completed; independent verification identified and prompted a test assertion for all four RPCs' `SECURITY DEFINER` declarations. Final focused result: `poetry run pytest tests/test_chat_budget_rls_migration.py` (1 passed); `git diff --check` passed with Windows line-ending warnings.
- Supabase migration version `20261002151729` (`chat_budget_ledger_rls`) applied. Readback confirms RLS enabled with FORCE RLS disabled on both ledger tables, anon/authenticated lack SELECT grants, and all four functions are SECURITY DEFINER with execute granted only to service_role (not anon/authenticated).
- Native `gentle-ai review assess` could not classify the worktree because of untracked files; selectorless STATUS returned `rdd_disabled`. RDD remains off, no review was started. Independent read-only verification found no remaining issues.
- Supabase Postgres remains the chosen shared ledger because it is the existing durable store and Render has no disk; the independent challenge could not confirm live pooler permissions. Disposable PostgreSQL concurrency testing remains pending.
- `CHAT-BUDGET-02`: implementation committed as `6490442`; database migration applied. User authorized a separate RLS migration for the new budget tables; direct grants to public client roles remain revoked.
- Budget verification: `poetry run pytest tests/test_chat_budget.py tests/test_chat_provider.py tests/test_api.py tests/test_deployment_config.py tests/test_health.py` (60 passed); `git diff --check` passed. The budget ledger's SQL concurrency/lock-order behavior has not been exercised against a disposable PostgreSQL instance; the RLS migrations were applied and read back separately.

## Next Step
Configure `CHAT_SERVICE_TOKEN` in Vercel and Render, deploy, and verify production.
