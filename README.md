# Portfolio Lucas 2026

Angular frontend and FastAPI backend for a CV-grounded portfolio chat. Static portfolio routes remain available if the chat service is unavailable or its content contract is incompatible.

## Quick local verification

Prerequisites: Node 24 with npm, Python 3.13, and the existing backend Poetry environment.

```powershell
# Frontend unit tests and production build
Push-Location frontend
npm.cmd test -- --watch=false
npm.cmd run build
Pop-Location

# Backend tests, including content rehash validation
Push-Location backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m pytest tests/test_content_contract.py -q
Pop-Location
```

For browser journeys, start Angular on the deterministic local address, run a scoped Playwright file against the existing server, then stop the server:

```powershell
Push-Location frontend
npm.cmd run start -- --host 127.0.0.1
# In another terminal (CI must be unset so Playwright reuses this server):
Remove-Item Env:CI -ErrorAction SilentlyContinue
npx.cmd playwright test e2e/portfolio-journeys.spec.ts --workers=1 --reporter=line --no-deps
```

Use `Ctrl+C` in the server terminal when the browser run finishes. On Windows, prove or force cleanup with:

```powershell
Get-NetTCPConnection -LocalPort 4200 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Get-NetTCPConnection -LocalPort 4200 -State Listen -ErrorAction SilentlyContinue
```

The final command must produce no listener. On other platforms, stop the foreground server with `Ctrl+C` or use the platform's port-owner tool (`lsof -ti :4200 | xargs kill` on Unix-like systems).

The tests use the credential-free `FakeProvider`; do not use production credentials for local verification.

## Local API smoke check

The chat endpoint now requires the service token, so the local smoke test must pass through the Vercel Function rather than call FastAPI directly. Use a local-only token; never commit it.

In the ignored `backend/.env`, set:

```dotenv
CHAT_SERVICE_TOKEN=<local-only-random-token>
```

Start FastAPI in one terminal:

```powershell
Push-Location backend
poetry run dev
```

In another PowerShell terminal at the repository root, set the same local token for Vercel Dev and start the frontend plus Function:

```powershell
$env:API_BASE_URL = 'http://127.0.0.1:8000'
$env:CHAT_SERVICE_TOKEN = '<local-only-random-token>'
npx.cmd vercel dev
```

Use the local URL printed by Vercel Dev for the browser and chat request. Health and metadata can still be checked directly against FastAPI; the chat request must go through the same-origin proxy:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/metadata
$body = '{"message":"Experiencia laboral","locale":"es","client_request_id":"local-smoke"}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
Invoke-WebRequest http://localhost:3000/api/v1/chat/stream -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes |
  Select-Object -ExpandProperty Content
```

Replace `localhost:3000` with the URL/port printed by Vercel Dev if it differs. Expect health `200`, matching `content_version` values from health and metadata, and ordered SSE that uses `event: start` and `event: done` (or emits one typed refusal/error). Stop both servers with `Ctrl+C`; on Windows use `Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` if necessary.

## Deployment configuration

| Target          | Source config                        | Build/runtime                                                                                | Public configuration                                                                                   |
| --------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Vercel frontend | `vercel.json`, `api/v1/chat/stream.js` | Builds `frontend/`; serves `frontend/dist/frontend/browser` and streams chat through a Node Function | Set `API_BASE_URL` for both the frontend build and Function runtime; chat-only `CHAT_SERVICE_TOKEN` is runtime-only. |
| Render backend | `render.yaml`, `backend/Dockerfile` | Free Docker web service; no persistent disk; binds `0.0.0.0:$PORT` | Set backend `CHAT_SERVICE_TOKEN`, exact `CORS_ALLOWED_ORIGINS`, project-scoped `CORS_PREVIEW_ORIGIN_REGEX`, and backend-only `SUPABASE_DB_URL`. |

The Render Docker image can be checked locally when Docker Desktop is running:

```powershell
docker build --file backend/Dockerfile --tag portfolio-backend:verify .
```

## Environment and secret ownership

| Variable                    | Owner        | Visibility                  | Notes                                                          |
| --------------------------- | ------------ | --------------------------- | -------------------------------------------------------------- |
| `API_BASE_URL`              | Vercel       | Public frontend build value | URL only; it is intentionally exposed to browsers.             |
| `CHAT_SERVICE_TOKEN`        | Vercel + Render | Secret (Vercel Function runtime and Render backend only) | Manually set the same random value on both platforms; never expose it to frontend builds or browsers. |
| `CORS_ALLOWED_ORIGINS`      | Render       | Backend configuration       | Comma-separated exact origins; never `*`.                      |
| `CORS_PREVIEW_ORIGIN_REGEX` | Render       | Backend configuration       | Anchored regex limited to this portfolio's Vercel previews.    |
| `OPENAI_API_KEY`            | Render only  | Secret                      | Never commit, expose to Vercel, log, or put in frontend files. |
| `SUPABASE_DB_URL`           | Render only  | Secret                      | Supavisor session-pooler URL; never expose to Vercel.          |
| `OPENAI_MODEL`              | Render       | Backend configuration       | Optional; defaults to `gpt-5-mini`.                            |
| `OPENAI_INPUT_COST_PER_MILLION` | Render    | Backend configuration       | Defaults to USD 0.25 for `gpt-5-mini`; align to the selected model. |
| `OPENAI_OUTPUT_COST_PER_MILLION` | Render   | Backend configuration       | Defaults to USD 2.00 for `gpt-5-mini`; align to the selected model. |
| `CHAT_MONTHLY_WARNING_USD`   | Render       | Backend configuration       | Defaults to USD 3; values above 3 are rejected.                |
| `CHAT_MONTHLY_BUDGET_USD`    | Render       | Backend configuration       | Defaults to USD 5; values above 5 are rejected.                |

The monthly chat budget uses the shared Supabase Postgres ledger, not Render memory. A conservative per-turn reservation is made before model work, then settled from cumulative provider usage. Each bounded provider call is admitted only when prior cumulative usage plus the UTF-8 byte length of its complete serialized request fits the 128,000 input accounting ceiling; this includes fixed instructions, JSON schema, tool definitions, and user/evidence input. Aggregate output is separately limited to 4,048 tokens. At the default `gpt-5-mini` rates, the resulting maximum reservation is USD 0.040096 per turn, rounded upward (`128,000 × 0.25 + 4,048 × 2`, per million tokens). Unknown usage after provider timeout/cancellation keeps the full reservation for that UTC month and logs `chat.budget_reservation_retained_unknown_usage`; this can reduce availability, intentionally. If `OPENAI_MODEL` changes, explicitly configure both token prices to at least the selected model's current rates. For `gpt-5-mini`, configured prices below USD 0.25 input / USD 2.00 output per million are rejected. Monthly cap and warning overrides may lower, but not raise, the approved USD 5 / USD 3 values.

Copy `frontend/.env.example` and `backend/.env.example` only as local references. Do not add real values to Git.

### Local chat proxy

The Angular dev server alone does not run the Vercel Function. For an authenticated local chat flow, set a local-only `CHAT_SERVICE_TOKEN` in the ignored `backend/.env`, use that same local value in the shell that starts Vercel Dev, and set `API_BASE_URL=http://127.0.0.1:8000` in that shell. Start `poetry run dev` from `backend`, then from the repository root run `npx vercel dev`. Open the Vercel Dev URL it prints. Metadata and contact continue to call the local backend using the public `API_BASE_URL`; chat goes through the local server-side function. Do not put the token in any frontend environment file or Angular build define.

For hosted setup, manually set `API_BASE_URL` as a Vercel build and Function runtime variable to the Render API base URL. Manually set the same newly chosen random `CHAT_SERVICE_TOKEN` as a Vercel **Function runtime-only** variable and as a Render secret variable. Keep both values out of this repository; do not use a frontend-prefixed/build-exposed variable for the token. Configure Preview and Production environments as needed.

## Preview, smoke, and rollback

1. Deploy static frontend routes first and confirm navigation works.
2. Manually apply `backend/supabase/migrations/202609200001_pdf_rag_pgvector.sql`, then manually run `poetry run python scripts/seed_pdf_rag.py` with backend secrets in your shell. Before enabling chat on a deployment, separately review and manually apply `backend/supabase/migrations/202610010001_chat_monthly_budget.sql`, and verify the backend database role can execute its service-role-only RPCs. Configure Render's dashboard with the Supavisor **session** pooler `SUPABASE_DB_URL`; do not use a frontend variable or a transaction pooler URL. This task does not apply or live-validate either migration.
3. Check Render `/health` and `/metadata`; both must agree on `content_version` before enabling chat traffic.
4. Send one supported and one unsupported Spanish request through the Vercel `/api/v1/chat/stream` proxy; confirm ordered SSE and a safe typed refusal. A direct request to Render without `CHAT_SERVICE_TOKEN` should return `401`.
5. Confirm a Vercel preview origin is accepted while an unrelated `*.vercel.app` origin is rejected.
6. If compatibility fails, the frontend disables chat while preserving static routes. Roll back the frontend and Render deployments independently; do not delete a prior Supabase PDF version before the replacement is active.

Hosted deployment, real OpenAI calls, provider billing, and Render/Vercel/Supabase secret configuration cannot be proven locally without hosted credentials. The local suite proves the fake-provider, content, CORS, build, and browser boundaries only.

## Compatibility, rollback, and restoration checks

With the controlled Angular server already running, the following scoped browser checks prove the compatibility boundary without hosted services:

```powershell
Push-Location frontend
# Mismatched metadata disables only chat and keeps /perfil available.
npx.cmd playwright test e2e/portfolio-journeys.spec.ts --grep "disables only chat" --workers=1 --reporter=line --no-deps
# Expected metadata restores the grounded chat rendering path.
npx.cmd playwright test e2e/portfolio-journeys.spec.ts --grep "renders a mocked grounded answer" --workers=1 --reporter=line --no-deps
Pop-Location
```

For a deployment rollback, restore the last known compatible Vercel frontend and Render backend releases independently, then repeat `/health`, `/metadata`, and the two scoped checks above. The mismatch check is the fail-safe: chat must remain disabled while static routes continue to work. Do not delete a Supabase PDF version before its replacement is active.
