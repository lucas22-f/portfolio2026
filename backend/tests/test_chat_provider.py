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


def _assert_concise_response_guidance(instructions: object) -> None:
    assert isinstance(instructions, str)
    assert "respuestas breves y fáciles de escanear" in instructions
    assert "2 a 4 oraciones" in instructions
    assert "como máximo, dos párrafos breves" in instructions
    assert "Evitá introducciones, repeticiones y listas largas" in instructions


def _assert_single_part_guidance(instructions: object) -> None:
    assert isinstance(instructions, str)
    assert "UNA sola parte de texto" in instructions
    assert "dentro del campo text de esa única parte" in instructions


def _response_with_parts(parts: list[object]) -> bytes:
    structured_output = json.dumps({"parts": parts}, ensure_ascii=False)
    return json.dumps(
        {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": structured_output}],
                }
            ],
            "usage": {"input_tokens": 1, "output_tokens": 1},
        },
        ensure_ascii=False,
    ).encode()


def test_initial_call_includes_concise_response_guidance() -> None:
    received: dict[str, object] = {}

    def transport(_: str, body: bytes, __: dict[str, str], ___: float) -> tuple[int, bytes]:
        received["body"] = json.loads(body)
        return (
            200,
            b'{"output":[{"type":"message","content":[{"type":"output_text","text":"{\\"parts\\":[{\\"type\\":\\"text\\",\\"text\\":\\"Respuesta\\",\\"grounding\\":\\"general\\"}]}"}]}],"usage":{"input_tokens":1,"output_tokens":1}}',
        )

    provider = OpenAIChatProvider(
        api_key="key", limits=ProviderLimits(model="test"), transport=transport
    )
    provider.generate("consulta general")

    body = received["body"]
    assert isinstance(body, dict)
    _assert_concise_response_guidance(body["instructions"])
    _assert_single_part_guidance(body["instructions"])
    assert "grounding general" in body["instructions"]


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
    parts_schema = body["text"]["format"]["schema"]["properties"]["parts"]
    assert parts_schema["minItems"] == 1
    assert parts_schema["maxItems"] == 1
    variants = parts_schema["items"]["anyOf"]
    assert variants[0]["required"] == ["type", "text", "grounding"]
    assert "citas de archivo y página las agrega el servidor" in body["instructions"]
    _assert_concise_response_guidance(body["instructions"])
    _assert_single_part_guidance(body["instructions"])
    assert "grounding portfolio" in body["instructions"]


def test_multiple_structured_parts_are_rejected() -> None:
    response = _response_with_parts(
        [
            {"type": "text", "text": "Primera.", "grounding": "general"},
            {"type": "text", "text": "Segunda.", "grounding": "general"},
        ]
    )
    provider = OpenAIChatProvider(
        api_key="key",
        limits=ProviderLimits(model="test"),
        transport=lambda *_: (200, response),
    )

    with pytest.raises(ProviderFailure, match="invalid-provider-output") as failure:
        provider.generate("consulta general")

    assert failure.value.diagnostic_category == "invalid-structured-parts-count"


def test_source_shaped_structured_part_is_rejected() -> None:
    response = _response_with_parts(
        [{"type": "source", "filename": "cv.pdf", "page": 1, "grounding": "general"}]
    )
    provider = OpenAIChatProvider(
        api_key="key",
        limits=ProviderLimits(model="test"),
        transport=lambda *_: (200, response),
    )

    with pytest.raises(ProviderFailure, match="invalid-provider-output") as failure:
        provider.generate("consulta general")

    assert failure.value.diagnostic_category == "invalid-structured-text-part"


def test_grounded_continuation_rejects_general_grounding() -> None:
    response = _response_with_parts(
        [{"type": "text", "text": "Respuesta.", "grounding": "general"}]
    )
    provider = OpenAIChatProvider(
        api_key="key",
        limits=ProviderLimits(model="test"),
        transport=lambda *_: (200, response),
    )

    with pytest.raises(ProviderFailure, match="invalid-provider-output") as failure:
        provider.generate(
            "consulta",
            {"chunks": [{"text": "evidence", "filename": "cv.pdf", "page": 1}]},
            ToolCall("consulta", "call-1", '{"query":"consulta"}'),
        )

    assert failure.value.diagnostic_category == "grounded-candidate-not-portfolio"


def test_initial_direct_answer_rejects_portfolio_grounding_without_tool() -> None:
    response = _response_with_parts(
        [{"type": "text", "text": "Respuesta.", "grounding": "portfolio"}]
    )
    provider = OpenAIChatProvider(
        api_key="key",
        limits=ProviderLimits(model="test"),
        transport=lambda *_: (200, response),
    )

    with pytest.raises(ProviderFailure, match="invalid-provider-output") as failure:
        provider.generate("consulta sobre Lucas")

    assert failure.value.diagnostic_category == "direct-candidate-not-general"


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

    with (
        patch(
            "app.infrastructure.chat_provider.urlopen",
            return_value=_SseResponse(
                [
                    {
                        "type": "response.output_text.delta",
                        "delta": '{"parts":[{"type":"text","text":"preview"',
                    },
                    {
                        "type": "response.completed",
                        "response": {
                            "output": [],
                            "usage": {"input_tokens": 1, "output_tokens": 1},
                        },
                    },
                ]
            ),
        ),
        pytest.raises(ProviderFailure, match="invalid-provider-output") as failure,
    ):
        provider.generate(
            "consulta",
            {"chunks": [{"text": "evidence", "filename": "cv.pdf", "page": 1}]},
            ToolCall("consulta", "call-1", '{"query":"consulta"}'),
            on_text_delta=deltas.append,
        )

    assert failure.value.diagnostic_category == "missing-output-text"
    assert deltas == ["preview"]


def test_provider_security_ceiling_defaults_remain_unchanged() -> None:
    limits = ProviderLimits()

    assert limits.model == "gpt-5-mini"
    assert limits.timeout_seconds == 15.0
    assert limits.max_input_tokens == 4_000
    assert limits.max_output_tokens == 4_048
    assert limits.cost_limit_usd == 0.05
    assert limits.input_cost_per_million == 0.0
    assert limits.output_cost_per_million == 0.0
