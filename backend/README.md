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

