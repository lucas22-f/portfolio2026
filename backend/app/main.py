from fastapi import FastAPI

app = FastAPI(title="Portfolio API", version="0.1.0")


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    """Expose a minimal scaffold health response."""
    return {"status": "ok"}

