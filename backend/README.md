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

