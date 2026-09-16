import json
from collections.abc import Iterator
from unittest.mock import patch

import pytest

from app.infrastructure.chat_provider import (
    OpenAIChatProvider,
    ProviderFailure,
    ProviderLimits,
    ToolCall,
)


class _SseResponse:
    def __init__(self, events: list[dict[str, object]]) -> None:
        self._lines = [
            line
            for event in events
            for line in (
                f"event: {event['type']}\n".encode(),
                f"data: {json.dumps(event, separators=(',', ':'))}\n".encode(),
                b"\n",
            )
        ]

    def __enter__(self) -> "_SseResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def __iter__(self) -> Iterator[bytes]:
        return iter(self._lines)


def test_grounded_call_uses_text_only_schema_and_server_owned_citations() -> None:
    received: dict[str, object] = {}

    def transport(_: str, body: bytes, __: dict[str, str], ___: float) -> tuple[int, bytes]:
        received["body"] = json.loads(body)
        return (
            200,
            b'{"output":[{"type":"message","content":[{"type":"output_text","text":"{\\"parts\\":[{\\"type\\":\\"text\\",\\"text\\":\\"Respuesta\\",\\"grounding\\":\\"portfolio\\"}]}"}]}],"usage":{"input_tokens":1,"output_tokens":1}}',
        )

    provider = OpenAIChatProvider(
        api_key="key", limits=ProviderLimits(model="test"), transport=transport
    )
    provider.generate(
        "consulta",
        {"chunks": [{"text": "evidence", "filename": "cv.pdf", "page": 1}]},
        ToolCall("consulta", "call-1", '{"query":"consulta"}'),
    )

    body = received["body"]
    assert isinstance(body, dict)
    variants = body["text"]["format"]["schema"]["properties"]["parts"]["items"]["anyOf"]
    assert variants[0]["required"] == ["type", "text", "grounding"]
    assert "citas de archivo y página las agrega el servidor" in body["instructions"]


def test_streamed_response_reconstructs_the_completed_structured_candidate() -> None:
    final_text = json.dumps(
        {"parts": [{"type": "text", "text": "Respuesta validada.", "grounding": "portfolio"}]}
    )
    completed = {
        "type": "response.completed",
        "response": {
            "output": [
                {"type": "message", "content": [{"type": "output_text", "text": final_text}]}
            ],
            "usage": {"input_tokens": 1, "output_tokens": 1},
        },
    }
    deltas: list[str] = []
    provider = OpenAIChatProvider(api_key="key", limits=ProviderLimits(model="test"))

    with patch(
        "app.infrastructure.chat_provider.urlopen",
        return_value=_SseResponse(
            [
                {"type": "response.output_text.delta", "delta": final_text[:32]},
                {"type": "response.output_text.delta", "delta": final_text[32:]},
                completed,
            ]
        ),
    ):
        result = provider.generate(
            "consulta",
            {"chunks": [{"text": "evidence", "filename": "cv.pdf", "page": 1}]},
            ToolCall("consulta", "call-1", '{"query":"consulta"}'),
            on_text_delta=deltas.append,
        )

    assert result == [{"type": "text", "text": "Respuesta validada.", "grounding": "portfolio"}]
    assert "".join(deltas) == "Respuesta validada."


def test_streamed_response_rejects_malformed_completion_after_a_preview() -> None:
    provider = OpenAIChatProvider(api_key="key", limits=ProviderLimits(model="test"))
    deltas: list[str] = []

    with patch(
        "app.infrastructure.chat_provider.urlopen",
        return_value=_SseResponse(
            [
                {
                    "type": "response.output_text.delta",
                    "delta": '{"parts":[{"type":"text","text":"preview"',
                },
                {
                    "type": "response.completed",
                    "response": {"output": [], "usage": {"input_tokens": 1, "output_tokens": 1}},
                },
            ]
        ),
    ), pytest.raises(ProviderFailure, match="invalid-provider-output") as failure:
        provider.generate(
            "consulta",
            {"chunks": [{"text": "evidence", "filename": "cv.pdf", "page": 1}]},
            ToolCall("consulta", "call-1", '{"query":"consulta"}'),
            on_text_delta=deltas.append,
        )

    assert failure.value.diagnostic_category == "missing-output-text"
    assert deltas == ["preview"]
