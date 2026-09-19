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

## Chat compatibility and PDF index

The chat indexes `app/docs/CV_Lucas_Figueroa_1.pdf` into persisted Chroma storage. Its PDF SHA-256 is an internal index lifecycle value: a changed PDF rebuilds the collection.

`content_version` in `/api/v1/metadata` and SSE events remains the reviewed `content/v1` portfolio version. The Angular static portfolio validates that value before enabling chat, so a PDF reindex does not falsely disable an otherwise compatible static UI.

## Interview contact delivery

Contact delivery is disabled by default. The browser receives only capability versions; Gmail SMTP credentials remain backend-only.

Enable the feature only after configuring `GMAIL_SMTP_EMAIL`, `GMAIL_SMTP_APP_PASSWORD`, and a dedicated `CONTACT_HMAC_SECRET`. `GMAIL_SMTP_APP_PASSWORD` must be a Google app password, not the Gmail account password. Configure bounded rate, TTL, and capacity values before setting `CONTACT_FORM_ENABLED=true`.

The current idempotency and rate-limit guard is in-memory and process-local. Do not enable it for multiple workers or replicas until a shared, non-persistent TTL guard is supplied. The first rollback action is always `CONTACT_FORM_ENABLED=false`; ordinary text chat remains available and no contact-data migration or cleanup is required.

