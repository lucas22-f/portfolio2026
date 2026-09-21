# Portfolio Backend

FastAPI service for the portfolio. Dependencies and virtual environments are managed with Poetry.

## Requirements

- Python 3.13
- Poetry 2.4 or newer

## Setup

Install dependencies and register the development command once:

```powershell
poetry install
```

Then start the local server with:

```powershell
poetry run dev
```

The production entry point is:

```powershell
poetry run uvicorn app.main:app --host 0.0.0.0 --port $env:PORT
```

## Chat compatibility and PDF retrieval

The chat queries the active Supabase pgvector PDF version. It never rebuilds or seeds at application startup. `SUPABASE_DB_URL` must be the backend-only Supavisor **session** pooler URL; use the IPv4-compatible connection string from Supabase.

Run `supabase/migrations/202609200001_pdf_rag_pgvector.sql` manually in the Supabase SQL editor, then manually run `poetry run python scripts/seed_pdf_rag.py` with `SUPABASE_DB_URL` and `OPENAI_API_KEY` set. The seeder publishes a complete new version atomically and no-ops when the active source SHA, embedding model, and dimensions already match. A model other than `text-embedding-3-small` is intentionally rejected because this deployment uses `pgvector(1536)`.

`content_version` in `/api/v1/metadata` and SSE events remains the reviewed `content/v1` portfolio version. The Angular static portfolio validates that value before enabling chat, so a PDF reseed does not falsely disable an otherwise compatible static UI.

## Interview contact delivery

Contact delivery is disabled by default. The browser receives only capability versions; Brevo credentials remain backend-only.

Enable the feature only after configuring `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_RECIPIENT_EMAIL`, and a dedicated `CONTACT_HMAC_SECRET`. `BREVO_SENDER_EMAIL` must be a sender email verified in Brevo; a verified custom domain is not required. Configure bounded rate, TTL, and capacity values before setting `CONTACT_FORM_ENABLED=true`.

The current idempotency and rate-limit guard is in-memory and process-local. Do not enable it for multiple workers or replicas until a shared, non-persistent TTL guard is supplied. The first rollback action is always `CONTACT_FORM_ENABLED=false`; ordinary text chat remains available and no contact-data migration or cleanup is required.

