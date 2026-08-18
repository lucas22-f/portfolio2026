"""Tests for credential-free chat provider infrastructure (task 3.3)."""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.infrastructure.chat_provider import (
    ChatProvider,
    FakeProvider,
    OpenAIChatProvider,
    ProviderConfigurationError,
    ProviderFailure,
    ProviderLimits,
)


def test_fake_provider_implements_provider_without_credentials() -> None:
    provider: ChatProvider = FakeProvider(candidates=[{"type": "text", "text": "Respuesta."}])

    assert provider.generate("Hola") == [{"type": "text", "text": "Respuesta."}]


def test_fake_provider_can_raise_a_controlled_failure() -> None:
    provider = FakeProvider(failure=ProviderFailure("provider-unavailable", retryable=True))

    with pytest.raises(ProviderFailure) as error:
        provider.generate("Hola")

    assert error.value.code == "provider-unavailable"
    assert error.value.retryable is True


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"model": ""}, "model"),
        ({"timeout_seconds": 0}, "timeout_seconds"),
        ({"cost_limit_usd": -1}, "cost_limit_usd"),
        ({"max_input_tokens": 0}, "max_input_tokens"),
        ({"max_output_tokens": 0}, "max_output_tokens"),
    ],
)
def test_limits_reject_invalid_configuration(kwargs: dict[str, Any], message: str) -> None:
    with pytest.raises(ProviderConfigurationError, match=message):
        ProviderLimits(**kwargs)


def test_openai_provider_posts_only_controlled_payload_and_returns_candidates() -> None:
    received: dict[str, Any] = {}

    def transport(
        url: str, body: bytes, headers: dict[str, str], timeout: float
    ) -> tuple[int, bytes]:
        received.update(url=url, body=json.loads(body), headers=headers, timeout=timeout)
        return 200, json.dumps(
            {
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": '{"parts":[{"type":"source","record_id":"project"}]}',
                            }
                        ],
                    }
                ],
                "usage": {"input_tokens": 4, "output_tokens": 3},
            }
        ).encode()

    provider = OpenAIChatProvider(
        api_key="test-secret",
        limits=ProviderLimits(model="gpt-test", timeout_seconds=2.5, cost_limit_usd=1.0),
        transport=transport,
    )

    result = provider.generate("Hola")

    assert result == [{"type": "source", "record_id": "project"}]
    assert received["url"] == "https://api.openai.com/v1/responses"
    assert received["headers"]["Authorization"] == "Bearer test-secret"
    assert received["timeout"] == 2.5
    assert received["body"]["model"] == "gpt-test"
    assert received["body"]["max_output_tokens"] == 512
    assert received["body"]["reasoning"] == {"effort": "low"}
    assert received["body"]["store"] is False
    assert received["body"]["input"] == "Hola"
    assert received["body"]["tools"][0]["name"] == "search_portfolio"


def test_openai_provider_uses_supported_strict_tool_string_schema() -> None:
    received: dict[str, Any] = {}

    def transport(_: str, body: bytes, __: dict[str, str], ___: float) -> tuple[int, bytes]:
        received.update(body=json.loads(body))
        return 200, json.dumps(
            {
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"parts":[]}'}],
                    }
                ],
                "usage": {"input_tokens": 4, "output_tokens": 3},
            }
        ).encode()

    OpenAIChatProvider(api_key="test-secret", transport=transport).generate("Hola")

    query_schema = received["body"]["tools"][0]["parameters"]["properties"]["query"]
    assert query_schema == {"type": "string"}


def test_openai_provider_finds_output_text_after_reasoning_item() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, json.dumps(
            {
                "output": [
                    {"type": "reasoning", "summary": []},
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": '{"parts":[{"type":"source","record_id":"project"}]}',
                            }
                        ],
                    },
                ],
                "usage": {"input_tokens": 4, "output_tokens": 3},
            }
        ).encode()

    provider = OpenAIChatProvider(api_key="test-secret", transport=transport)

    assert provider.generate("Hola") == [{"type": "source", "record_id": "project"}]


def test_openai_provider_rejects_response_without_output_text() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, json.dumps(
            {
                "output": [
                    {"type": "reasoning", "summary": []},
                    {"type": "message", "content": [{"type": "refusal", "refusal": "No"}]},
                ],
                "usage": {"input_tokens": 4, "output_tokens": 3},
            }
        ).encode()

    provider = OpenAIChatProvider(api_key="test-secret", transport=transport)

    with pytest.raises(ProviderFailure) as error:
        provider.generate("Hola")

    assert error.value.code == "invalid-provider-output"
    assert error.value.retryable is False
    assert error.value.diagnostic_category == "missing-output-text"


def test_openai_provider_captures_safe_no_text_response_metadata() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, json.dumps(
            {
                "status": "incomplete",
                "incomplete_details": {"reason": "content_filter", "private": "do not log"},
                "error": {"code": "safety_refusal", "message": "do not log this provider text"},
                "output": [
                    {"type": "reasoning", "summary": [{"text": "do not log"}]},
                    {
                        "type": "message",
                        "content": [{"type": "refusal", "refusal": "do not log"}],
                    },
                ],
                "usage": {
                    "input_tokens": 4,
                    "output_tokens": 3,
                    "total_tokens": 7,
                    "input_tokens_details": {"cached_tokens": 2},
                    "output_tokens_details": {"reasoning_tokens": 1},
                },
            }
        ).encode()

    with pytest.raises(ProviderFailure) as error:
        OpenAIChatProvider(api_key="test-secret", transport=transport).generate("Hola")

    assert error.value.diagnostic_category == "missing-output-text"
    assert error.value.diagnostic_metadata == {
        "status": "incomplete",
        "incomplete_reason": "content_filter",
        "error_code": "safety_refusal",
        "output_item_types": ["reasoning", "message"],
        "output_content_types": [[], ["refusal"]],
        "usage_tokens": {
            "input_tokens": 4,
            "output_tokens": 3,
            "total_tokens": 7,
            "input_tokens_details.cached_tokens": 2,
            "output_tokens_details.reasoning_tokens": 1,
        },
    }
    assert "do not log" not in json.dumps(error.value.diagnostic_metadata)


@pytest.mark.parametrize(
    ("second_output", "diagnostic_category"),
    [
        (
            [
                {
                    "type": "function_call",
                    "call_id": "call-2",
                    "name": "search_portfolio",
                    "arguments": '{"query":"Lucas"}',
                }
            ],
            "unexpected-function-call-after-tool-output",
        ),
        (
            [{"type": "message", "content": [{"type": "refusal", "refusal": "No"}]}],
            "missing-output-text",
        ),
        (
            [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": '{"parts":[]}'}],
                },
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": '{"parts":[]}'}],
                },
            ],
            "multiple-output-text",
        ),
        (
            [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "not json"}],
                }
            ],
            "output-text-json-parse-failed",
        ),
        (
            [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": '{"parts":{}}'}],
                }
            ],
            "invalid-structured-parts-shape",
        ),
    ],
)
def test_openai_provider_categorizes_second_turn_parser_failures(
    second_output: list[dict[str, object]], diagnostic_category: str
) -> None:
    responses = [
        {
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "search_portfolio",
                    "arguments": '{"query":"Lucas"}',
                }
            ],
            "usage": {"input_tokens": 4, "output_tokens": 3},
        },
        {"output": second_output, "usage": {"input_tokens": 4, "output_tokens": 3}},
    ]

    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, json.dumps(responses.pop(0)).encode()

    provider = OpenAIChatProvider(api_key="test-secret", transport=transport)
    first = provider.generate("¿Qué experiencia tiene Lucas?")

    with pytest.raises(ProviderFailure) as error:
        provider.generate("¿Qué experiencia tiene Lucas?", {"records": []}, first.tool_call)

    assert error.value.code == "invalid-provider-output"
    assert error.value.retryable is False
    assert error.value.diagnostic_category == diagnostic_category


def test_openai_provider_requests_spanish_grounded_structured_candidate_parts() -> None:
    received: dict[str, Any] = {}

    def transport(_: str, body: bytes, __: dict[str, str], ___: float) -> tuple[int, bytes]:
        received.update(body=json.loads(body))
        return 200, json.dumps(
            {
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"parts":[]}'}],
                    }
                ],
                "usage": {"input_tokens": 4, "output_tokens": 3},
            }
        ).encode()

    OpenAIChatProvider(api_key="test-secret", transport=transport).generate("Hola")

    body = received["body"]
    assert "search_portfolio" in body["instructions"]
    assert body["text"]["format"] == {
        "type": "json_schema",
        "name": "candidate_parts",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "parts": {
                    "type": "array",
                    "items": {
                        "anyOf": [
                            {
                                "type": "object",
                                "properties": {
                                    "type": {"type": "string", "const": "text"},
                                    "text": {"type": "string"},
                                    "grounding": {
                                        "type": "string",
                                        "enum": ["general", "portfolio"],
                                    },
                                    "record_ids": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                    "claim_ids": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                },
                                "required": [
                                    "type",
                                    "text",
                                    "grounding",
                                    "record_ids",
                                    "claim_ids",
                                ],
                                "additionalProperties": False,
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "type": {"type": "string", "const": "source"},
                                    "record_id": {"type": "string"},
                                },
                                "required": ["type", "record_id"],
                                "additionalProperties": False,
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "type": {"type": "string", "const": "project-card"},
                                    "record_id": {"type": "string"},
                                },
                                "required": ["type", "record_id"],
                                "additionalProperties": False,
                            },
                        ]
                    },
                }
            },
            "required": ["parts"],
            "additionalProperties": False,
        },
    }


def test_openai_provider_uses_supported_anyof_for_candidate_part_variants() -> None:
    received: dict[str, Any] = {}

    def transport(_: str, body: bytes, __: dict[str, str], ___: float) -> tuple[int, bytes]:
        received.update(body=json.loads(body))
        return 200, json.dumps(
            {
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"parts":[]}'}],
                    }
                ],
                "usage": {"input_tokens": 4, "output_tokens": 3},
            }
        ).encode()

    OpenAIChatProvider(api_key="test-secret", transport=transport).generate("Hola")

    part_variants = received["body"]["text"]["format"]["schema"]["properties"]["parts"]["items"]
    assert "oneOf" not in part_variants
    assert [variant["properties"]["type"]["const"] for variant in part_variants["anyOf"]] == [
        "text",
        "source",
        "project-card",
    ]


@pytest.mark.parametrize(
    "structured_output",
    [
        "[]",
        "{}",
        '{"parts":{}}',
        '{"parts":[],"extra":true}',
    ],
)
def test_openai_provider_rejects_malformed_structured_output_wrapper(
    structured_output: str,
) -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, json.dumps(
            {
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": structured_output}],
                    }
                ],
                "usage": {"input_tokens": 4, "output_tokens": 3},
            }
        ).encode()

    with pytest.raises(ProviderFailure, match="invalid-provider-output"):
        OpenAIChatProvider(api_key="test-secret", transport=transport).generate("Hola")


def test_openai_provider_blocks_usage_over_limits_without_returning_raw_output() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, json.dumps(
            {
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"parts":[]}'}],
                    }
                ],
                "usage": {"input_tokens": 11, "output_tokens": 1},
            }
        ).encode()

    provider = OpenAIChatProvider(
        api_key="test-secret",
        limits=ProviderLimits(max_input_tokens=10),
        transport=transport,
    )

    with pytest.raises(ProviderFailure) as error:
        provider.generate("Hola")

    assert error.value.code == "limit-exceeded"
    assert "output" not in str(error.value).lower()
    assert "test-secret" not in str(error.value)


def test_openai_provider_rejects_adversarial_unicode_before_transport() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        pytest.fail("transport must not be called when the preflight limit is exceeded")

    provider = OpenAIChatProvider(
        api_key="test-secret",
        limits=ProviderLimits(max_input_tokens=11),
        transport=transport,
    )

    with pytest.raises(ProviderFailure) as error:
        provider.generate("😀😀😀")

    assert error.value.code == "limit-exceeded"
    assert error.value.retryable is False


def test_openai_provider_maps_non_utf8_success_response_to_safe_failure() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, b"\xff"

    provider = OpenAIChatProvider(api_key="test-secret", transport=transport)

    with pytest.raises(ProviderFailure) as error:
        provider.generate("Hola")

    assert error.value.code == "invalid-provider-output"
    assert error.value.retryable is False


@pytest.mark.parametrize(
    ("status", "code", "category"),
    [
        (401, "provider-unavailable", "auth"),
        (403, "provider-unavailable", "auth"),
        (429, "rate-limited", "rate-limit"),
        (400, "provider-unavailable", "request-rejected"),
        (500, "provider-unavailable", "upstream"),
    ],
)
def test_openai_provider_maps_http_failures_to_safe_diagnostic_categories(
    status: int, code: str, category: str
) -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return status, b'{"error":{"message":"provider raw response"}}'

    provider = OpenAIChatProvider(api_key="test-secret", transport=transport)

    with pytest.raises(ProviderFailure) as error:
        provider.generate("Hola")

    assert error.value.code == code
    assert error.value.retryable is True
    assert error.value.diagnostic_category == category
    assert "raw response" not in str(error.value)


def test_openai_provider_maps_transport_failure_without_exposing_inputs() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        raise TimeoutError("provider failed")

    provider = OpenAIChatProvider(api_key="test-secret", transport=transport)

    with pytest.raises(ProviderFailure) as error:
        provider.generate("private prompt")

    assert error.value.code == "provider-timeout"
    assert error.value.diagnostic_category == "transport"
    assert "private" not in str(error.value)
    assert "test-secret" not in str(error.value)


def test_openai_provider_maps_network_error_to_transport_diagnostic_category() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        raise OSError("private network detail")

    provider = OpenAIChatProvider(api_key="test-secret", transport=transport)

    with pytest.raises(ProviderFailure) as error:
        provider.generate("private prompt")

    assert error.value.code == "provider-unavailable"
    assert error.value.diagnostic_category == "transport"
    assert "private" not in str(error.value)


def test_openai_provider_returns_one_valid_portfolio_tool_call() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, json.dumps(
            {
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "search_portfolio",
                        "arguments": '{"query":"MercadoLibre"}',
                    }
                ],
                "usage": {"input_tokens": 4, "output_tokens": 3},
            }
        ).encode()

    result = OpenAIChatProvider(api_key="test-secret", transport=transport).generate(
        "¿Dónde trabaja Lucas?"
    )

    assert result == []
    assert result.tool_call is not None
    assert result.tool_call.query == "MercadoLibre"
    assert result.total_tokens == 7


@pytest.mark.parametrize(
    "calls",
    [
        [{"type": "function_call", "call_id": "one", "name": "unknown", "arguments": "{}"}],
        [
            {
                "type": "function_call",
                "call_id": "one",
                "name": "search_portfolio",
                "arguments": "{}",
            }
        ],
        [
            {
                "type": "function_call",
                "call_id": "one",
                "name": "search_portfolio",
                "arguments": '{"query":"a"}',
            },
            {
                "type": "function_call",
                "call_id": "two",
                "name": "search_portfolio",
                "arguments": '{"query":"b"}',
            },
        ],
    ],
)
def test_openai_provider_rejects_unknown_malformed_or_multiple_tool_calls(
    calls: list[dict[str, object]],
) -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, json.dumps(
            {"output": calls, "usage": {"input_tokens": 4, "output_tokens": 3}}
        ).encode()

    with pytest.raises(ProviderFailure, match="invalid-provider-output"):
        OpenAIChatProvider(api_key="test-secret", transport=transport).generate("Consulta")


def test_openai_provider_accumulates_second_turn_usage() -> None:
    bodies: list[dict[str, object]] = []
    responses = [
        {
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "search_portfolio",
                    "arguments": '{"query":"MercadoLibre"}',
                }
            ],
            "usage": {"input_tokens": 4, "output_tokens": 3},
        },
        {
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": (
                                '{"parts":[{"type":"text","text":"Lucas trabaja en MercadoLibre.",'
                                '"grounding":"portfolio","record_ids":["r"],"claim_ids":["c"]}]}'
                            ),
                        }
                    ],
                }
            ],
            "usage": {"input_tokens": 5, "output_tokens": 4},
        },
    ]

    def transport(_: str, body: bytes, __: dict[str, str], ___: float) -> tuple[int, bytes]:
        bodies.append(json.loads(body))
        return 200, json.dumps(responses.pop(0)).encode()

    provider = OpenAIChatProvider(
        api_key="test-secret", limits=ProviderLimits(max_input_tokens=1_000), transport=transport
    )
    first = provider.generate("¿Dónde trabaja Lucas?")
    assert first.tool_call is not None
    second = provider.generate(
        "¿Dónde trabaja Lucas?",
        {"records": [{"id": "r", "claims": [{"claim_id": "c", "text": "public"}]}]},
        first.tool_call,
        first.total_input_tokens,
        first.total_output_tokens,
    )

    assert second.total_tokens == 16
    assert "tools" not in bodies[1]
    assert bodies[1]["store"] is False
    assert bodies[0]["max_output_tokens"] == 512
    assert bodies[1]["max_output_tokens"] == 1_021
    assert bodies[0]["reasoning"] == {"effort": "low"}
    assert bodies[1]["reasoning"] == {"effort": "low"}
    assert "copiá record_ids y claim_ids exactamente" in bodies[1]["instructions"]
    assert "cada claim_id debe pertenecer al record_id citado" in bodies[1]["instructions"]
    assert "grounding general con record_ids y claim_ids vacíos" in bodies[1]["instructions"]
    tool_output = bodies[1]["input"][2]
    assert tool_output["type"] == "function_call_output"
    assert json.loads(tool_output["output"]) == {
        "records": [{"id": "r", "claims": [{"claim_id": "c", "text": "public"}]}]
    }


def test_openai_provider_preserves_aggregate_budget_after_routing_call() -> None:
    bodies: list[dict[str, object]] = []
    responses = [
        {
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "search_portfolio",
                    "arguments": '{"query":"x"}',
                }
            ],
            "usage": {"input_tokens": 10, "output_tokens": 512},
        },
        {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": '{"parts":[]}'}],
                }
            ],
            "usage": {"input_tokens": 20, "output_tokens": 42},
        },
    ]

    def transport(_: str, body: bytes, __: dict[str, str], ___: float) -> tuple[int, bytes]:
        bodies.append(json.loads(body))
        return 200, json.dumps(responses.pop(0)).encode()

    provider = OpenAIChatProvider(
        api_key="test-secret",
        limits=ProviderLimits(max_input_tokens=1_000, max_output_tokens=1_024),
        transport=transport,
    )
    first = provider.generate("Pregunta sobre Lucas")
    second = provider.generate(
        "Pregunta sobre Lucas",
        {"records": []},
        first.tool_call,
        first.total_input_tokens,
        first.total_output_tokens,
    )

    assert first.tool_call is not None
    assert bodies[0]["max_output_tokens"] == 512
    assert bodies[1]["max_output_tokens"] == 512
    assert [body["reasoning"] for body in bodies] == [{"effort": "low"}] * 2
    assert second.total_input_tokens == 30
    assert second.total_output_tokens == 554
    assert second.total_output_tokens <= 1_024


def test_openai_provider_keeps_incomplete_grounded_turn_as_safe_failure_without_retry() -> None:
    calls = 0
    responses = [
        {
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "search_portfolio",
                    "arguments": '{"query":"x"}',
                }
            ],
            "usage": {"input_tokens": 1, "output_tokens": 1},
        },
        {
            "status": "incomplete",
            "incomplete_details": {"reason": "max_output_tokens"},
            "output": [{"type": "reasoning", "summary": []}],
            "usage": {"input_tokens": 2, "output_tokens": 768},
        },
    ]

    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        nonlocal calls
        calls += 1
        return 200, json.dumps(responses.pop(0)).encode()

    provider = OpenAIChatProvider(api_key="test-secret", transport=transport)
    first = provider.generate("Pregunta sobre Lucas")

    with pytest.raises(ProviderFailure) as error:
        provider.generate(
            "Pregunta sobre Lucas",
            {"records": []},
            first.tool_call,
            first.total_input_tokens,
            first.total_output_tokens,
        )

    assert error.value.code == "invalid-provider-output"
    assert error.value.retryable is False
    assert error.value.diagnostic_category == "missing-output-text"
    assert error.value.diagnostic_metadata["incomplete_reason"] == "max_output_tokens"
    assert calls == 2


def test_openai_provider_enforces_cumulative_input_limit_before_second_call() -> None:
    calls = 0

    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        nonlocal calls
        calls += 1
        return 200, json.dumps(
            {
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "search_portfolio",
                        "arguments": '{"query":"x"}',
                    }
                ],
                "usage": {"input_tokens": 4, "output_tokens": 3},
            }
        ).encode()

    provider = OpenAIChatProvider(
        api_key="test-secret", limits=ProviderLimits(max_input_tokens=10), transport=transport
    )
    first = provider.generate("x")
    assert first.tool_call is not None
    with pytest.raises(ProviderFailure, match="limit-exceeded"):
        provider.generate(
            "x",
            {"records": []},
            first.tool_call,
            first.total_input_tokens,
            first.total_output_tokens,
        )
    assert calls == 1


def test_openai_provider_projects_cost_across_both_turns() -> None:
    calls = 0

    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        nonlocal calls
        calls += 1
        return 200, json.dumps(
            {
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "search_portfolio",
                        "arguments": '{"query":"x"}',
                    }
                ],
                "usage": {"input_tokens": 1, "output_tokens": 3},
            }
        ).encode()

    provider = OpenAIChatProvider(
        api_key="test-secret",
        limits=ProviderLimits(
            max_input_tokens=1_000,
            max_output_tokens=4,
            cost_limit_usd=10.0,
            input_cost_per_million=1_000_000,
        ),
        transport=transport,
    )
    first = provider.generate("x")
    assert first.tool_call is not None

    with pytest.raises(ProviderFailure, match="limit-exceeded"):
        provider.generate(
            "x",
            {"records": []},
            first.tool_call,
            first.total_input_tokens,
            first.total_output_tokens,
        )
    assert calls == 1


def test_openai_provider_rejects_output_over_aggregate_turn_budget() -> None:
    responses = [
        {
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "search_portfolio",
                    "arguments": '{"query":"x"}',
                }
            ],
            "usage": {"input_tokens": 1, "output_tokens": 3},
        },
        {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": '{"parts":[]}'}],
                }
            ],
            "usage": {"input_tokens": 1, "output_tokens": 2},
        },
    ]

    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, json.dumps(responses.pop(0)).encode()

    provider = OpenAIChatProvider(
        api_key="test-secret",
        limits=ProviderLimits(max_input_tokens=1_000, max_output_tokens=4),
        transport=transport,
    )
    first = provider.generate("x")
    assert first.tool_call is not None
    with pytest.raises(ProviderFailure, match="limit-exceeded"):
        provider.generate(
            "x",
            {"records": []},
            first.tool_call,
            first.total_input_tokens,
            first.total_output_tokens,
        )


@pytest.mark.parametrize("prior_input_tokens,prior_output_tokens", [(-1, 0), (0, -1)])
def test_openai_provider_rejects_negative_prior_usage(
    prior_input_tokens: int, prior_output_tokens: int
) -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        pytest.fail("transport must not receive invalid prior usage")

    with pytest.raises(ProviderFailure, match="invalid-provider-output"):
        OpenAIChatProvider(api_key="test-secret", transport=transport).generate(
            "Hola",
            prior_input_tokens=prior_input_tokens,
            prior_output_tokens=prior_output_tokens,
        )


@pytest.mark.parametrize(
    "usage",
    [{"input_tokens": -1, "output_tokens": 1}, {"input_tokens": 1, "output_tokens": -1}],
)
def test_openai_provider_rejects_negative_reported_usage(usage: dict[str, int]) -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, json.dumps(
            {
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"parts":[]}'}],
                    }
                ],
                "usage": usage,
            }
        ).encode()

    with pytest.raises(ProviderFailure, match="limit-exceeded"):
        OpenAIChatProvider(api_key="test-secret", transport=transport).generate("Hola")
