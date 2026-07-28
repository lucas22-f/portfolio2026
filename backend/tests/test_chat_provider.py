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

    assert provider.generate([{"record_id": "project"}], {"locale": "es"}) == [
        {"type": "text", "text": "Respuesta."}
    ]


def test_fake_provider_can_raise_a_controlled_failure() -> None:
    provider = FakeProvider(failure=ProviderFailure("provider-unavailable", retryable=True))

    with pytest.raises(ProviderFailure) as error:
        provider.generate([], {})

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
                                "text": '[{"type":"source","record_id":"project"}]',
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

    result = provider.generate([{"record_id": "project"}], {"locale": "es"})

    assert result == [{"type": "source", "record_id": "project"}]
    assert received["url"] == "https://api.openai.com/v1/responses"
    assert received["headers"]["Authorization"] == "Bearer test-secret"
    assert received["timeout"] == 2.5
    assert received["body"]["model"] == "gpt-test"
    assert received["body"]["max_output_tokens"] == 512
    assert received["body"]["store"] is False
    assert json.loads(received["body"]["input"]) == {
        "candidates": [{"record_id": "project"}],
        "bundle": {"locale": "es"},
    }


def test_openai_provider_blocks_usage_over_limits_without_returning_raw_output() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, json.dumps(
            {
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "[]"}]}],
                "usage": {"input_tokens": 11, "output_tokens": 1},
            }
        ).encode()

    provider = OpenAIChatProvider(
        api_key="test-secret",
        limits=ProviderLimits(max_input_tokens=10),
        transport=transport,
    )

    with pytest.raises(ProviderFailure) as error:
        provider.generate([], {})

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
        provider.generate([], {"value": "😀"})

    assert error.value.code == "limit-exceeded"
    assert error.value.retryable is False


def test_openai_provider_maps_non_utf8_success_response_to_safe_failure() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return 200, b"\xff"

    provider = OpenAIChatProvider(api_key="test-secret", transport=transport)

    with pytest.raises(ProviderFailure) as error:
        provider.generate([], {})

    assert error.value.code == "invalid-provider-output"
    assert error.value.retryable is False


@pytest.mark.parametrize("status", [429, 500])
def test_openai_provider_maps_http_failures_without_exposing_response(status: int) -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        return status, b'{"error":{"message":"provider raw response"}}'

    provider = OpenAIChatProvider(api_key="test-secret", transport=transport)

    with pytest.raises(ProviderFailure) as error:
        provider.generate([], {})

    assert error.value.code == ("rate-limited" if status == 429 else "provider-unavailable")
    assert error.value.retryable is True
    assert "raw response" not in str(error.value)


def test_openai_provider_maps_transport_failure_without_exposing_inputs() -> None:
    def transport(_: str, __: bytes, ___: dict[str, str], ____: float) -> tuple[int, bytes]:
        raise TimeoutError("provider failed")

    provider = OpenAIChatProvider(api_key="test-secret", transport=transport)

    with pytest.raises(ProviderFailure) as error:
        provider.generate([{"prompt": "private prompt"}], {"bundle": "private"})

    assert error.value.code == "provider-timeout"
    assert "private" not in str(error.value)
    assert "test-secret" not in str(error.value)
