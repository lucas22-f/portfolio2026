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

The development commands run the full local flow with the credential-free `FakeProvider`.
Production behavior remains unchanged and still requires its configured provider.

```powershell
Push-Location backend
poetry run dev
```

In another terminal, start the frontend. Its development build points to the local API automatically:

```powershell
Push-Location frontend
npm.cmd run start
```

In another PowerShell terminal, run the complete smoke sequence:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/metadata
$body = '{"message":"Experiencia laboral","locale":"es","client_request_id":"local-smoke"}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
Invoke-WebRequest http://127.0.0.1:8000/api/v1/chat/stream -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes |
  Select-Object -ExpandProperty Content
```

Expect health `200`, matching `content_version` values from health and metadata, and ordered NDJSON that starts with `start` and ends with `done` (or emits one typed refusal/error). Stop the fake server with `Ctrl+C`; on Windows use `Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` if necessary.

## Deployment configuration

| Target          | Source config                        | Build/runtime                                                                                | Public configuration                                                                                   |
| --------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Vercel frontend | `vercel.json`                        | Builds `frontend/`; serves `frontend/dist/frontend/browser`                                  | `API_BASE_URL` is public and points to the Railway API URL. Set separately for Preview and Production. |
| Railway backend | `railway.json`, `backend/Dockerfile` | Docker context is repository root; copies `backend/` and `content/v1`; binds `0.0.0.0:$PORT` | Exact `CORS_ALLOWED_ORIGINS` and project-scoped `CORS_PREVIEW_ORIGIN_REGEX`.                           |

The Railway image can be checked locally when Docker Desktop is running:

```powershell
docker build --file backend/Dockerfile --tag portfolio-backend:verify .
```

## Environment and secret ownership

| Variable                    | Owner        | Visibility                  | Notes                                                          |
| --------------------------- | ------------ | --------------------------- | -------------------------------------------------------------- |
| `API_BASE_URL`              | Vercel       | Public frontend build value | URL only; it is intentionally exposed to browsers.             |
| `CORS_ALLOWED_ORIGINS`      | Railway      | Backend configuration       | Comma-separated exact origins; never `*`.                      |
| `CORS_PREVIEW_ORIGIN_REGEX` | Railway      | Backend configuration       | Anchored regex limited to this portfolio's Vercel previews.    |
| `OPENAI_API_KEY`            | Railway only | Secret                      | Never commit, expose to Vercel, log, or put in frontend files. |
| `OPENAI_MODEL`              | Railway      | Backend configuration       | Optional; defaults to `gpt-5-mini`.                            |

Copy `frontend/.env.example` and `backend/.env.example` only as local references. Do not add real values to Git.

## Preview, smoke, and rollback

1. Deploy static frontend routes first and confirm navigation works.
2. Check Railway `/health` and `/metadata`; both must agree on `content_version` before enabling chat traffic.
3. Send one supported and one unsupported Spanish request to `/api/v1/chat/stream`; confirm ordered NDJSON and a safe typed refusal.
4. Confirm a Vercel preview origin is accepted while an unrelated `*.vercel.app` origin is rejected.
5. If compatibility fails, the frontend disables chat while preserving static routes. Roll back the frontend and Railway deployments independently; no data migration is required.

Hosted deployment, real OpenAI calls, provider billing, and Railway/Vercel secret configuration cannot be proven locally without hosted credentials. The local suite proves the fake-provider, content, CORS, build, and browser boundaries only.

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

For a deployment rollback, restore the last known compatible Vercel frontend and Railway backend releases independently, then repeat `/health`, `/metadata`, and the two scoped checks above. The mismatch check is the fail-safe: chat must remain disabled while static routes continue to work. No data migration or secret rotation is part of this rollback.
