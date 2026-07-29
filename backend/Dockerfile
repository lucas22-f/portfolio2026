FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VIRTUALENVS_CREATE=false

WORKDIR /app/backend

RUN pip install --no-cache-dir "poetry==2.4.1"

COPY backend/pyproject.toml backend/poetry.lock ./
COPY backend/README.md ./
RUN poetry install --only main --sync --no-interaction

COPY backend/app ./app
COPY content/v1 /app/content/v1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
