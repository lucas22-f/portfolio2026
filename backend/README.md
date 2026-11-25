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

Chat requests may include up to six recent completed user/assistant exchanges as optional `history`. Each user entry is limited to 500 characters and each assistant entry to 4,000; older clients may omit it. Context is sent only for the current stateless provider call, is never treated as portfolio evidence, and is not persisted. The current message is sent separately exactly once.

## Microphone transcription

`POST /api/v1/chat/transcribe` accepts raw `audio/wav` only, protected by the same
constant-time `CHAT_SERVICE_TOKEN` check as text chat. Production uses the existing
backend-only `OPENAI_API_KEY` and the fixed `gpt-4o-mini-transcribe` model through a
one-shot stdlib HTTPS multipart request (20-second socket timeout, no redirects or
retries). No multipart parser dependency is needed on FastAPI.

The backend independently accepts only a canonical 44-byte-header RIFF/WAV with
one PCM16 mono data chunk, 16–48 kHz, at most 30 seconds and 3,000,000 total bytes.
Compressed, truncated, inconsistent or extra-chunk WAVs are rejected before
admission and billing. Upload reads have a 10-second timeout. Responses are bounded;
errors contain neither provider details nor audio/transcript payloads.

After validation, transcription shares `ChatAdmissionGuard` and the existing
monthly budget ledger/cap with text chat. Each call reserves **USD 0.03 before the
provider is invoked**, and retains the full reservation after success, failure or
uncertain cancellation. This deliberately sacrifices capacity rather than settling
audio with unrelated text-token prices. An unavailable ledger fails closed; no
monthly cap or text-chat pricing is changed. Retained reservations consume that
month's capacity and are not automatically released or retried.

**Pricing assumption, not a verified current OpenAI tariff:** the earlier reference
was USD 0.003/minute. The reservation rounds every bounded <=30-second recording
up to one minute and applies a 10x safety factor: `1 × 0.003 × 10 = USD 0.03`.
This is a conservative planning allowance under that explicit assumption, not a
provider-guaranteed price ceiling. Confirm current pricing before deployment and
reassess/disable transcription if that allowance no longer covers bounded requests.
The implementation has not called a paid provider to verify prices or behavior.

The same-origin Vercel function `api/v1/chat/transcribe.js` disables body parsing,
forwards only to the fixed backend path with server-side credentials, refuses
redirects, bounds input/output, aborts disconnected requests and has a 25-second
deadline. It forwards only the transcript, never arbitrary upstream headers or
error bodies. Local frontend-only `ng serve` does not host this function; use a
same-origin API development deployment for microphone integration tests, never put
the service token in the browser.

Audio is held only in request memory; the portfolio does not persist or log audio
or transcripts. This makes no claim about OpenAI retention policies. The endpoint
returns an editable transcript, never a chat completion. Text messages retain the
existing 500-character server limit.

Mock-only focused backend tests: `python -m pytest tests/test_transcription.py -q`.
Proxy tests from repository root:
`node --test api/v1/chat/transcribe.test.js api/v1/chat/stream.test.js`.

## Interview contact delivery

Contact delivery is disabled by default. The browser receives only capability versions; Brevo credentials remain backend-only.

Enable the feature only after configuring `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_RECIPIENT_EMAIL`, and a dedicated `CONTACT_HMAC_SECRET`. `BREVO_SENDER_EMAIL` must be a sender email verified in Brevo; a verified custom domain is not required. Configure bounded rate, TTL, and capacity values before setting `CONTACT_FORM_ENABLED=true`.

The current idempotency and rate-limit guard is in-memory and process-local. Do not enable it for multiple workers or replicas until a shared, non-persistent TTL guard is supplied. The first rollback action is always `CONTACT_FORM_ENABLED=false`; ordinary text chat remains available and no contact-data migration or cleanup is required.

