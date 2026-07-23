import uvicorn


def main() -> None:
    """Run the API locally with automatic reload."""
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
