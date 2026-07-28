"""Provider adapters with bounded, secret-safe OpenAI calls."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

Candidate = dict[str, object]


class ProviderResult(list[Candidate]):
    """Validated candidates with provider-reported token usage."""

    def __init__(self, candidates: Sequence[Mapping[str, object]], *, total_tokens: int) -> None:
        super().__init__(dict(candidate) for candidate in candidates)
        self.total_tokens = total_tokens


Transport = Callable[[str, bytes, dict[str, str], float], tuple[int, bytes]]


class ProviderConfigurationError(ValueError):
    """Raised when provider controls are unsafe or incomplete."""


class ProviderFailure(RuntimeError):
    """A recoverable provider error that never contains provider payloads."""

    def __init__(self, code: str, *, retryable: bool) -> None:
        self.code = code
        self.retryable = retryable
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class ProviderLimits:
    """Explicit per-request controls, configured at application startup."""

    model: str = "gpt-5-mini"
    timeout_seconds: float = 15.0
    cost_limit_usd: float = 0.05
    max_input_tokens: int = 4_000
    max_output_tokens: int = 512
    input_cost_per_million: float = 0.0
    output_cost_per_million: float = 0.0

    def __post_init__(self) -> None:
        if not self.model.strip():
            raise ProviderConfigurationError("model must not be empty")
        if self.timeout_seconds <= 0:
            raise ProviderConfigurationError("timeout_seconds must be positive")
        if self.cost_limit_usd < 0:
            raise ProviderConfigurationError("cost_limit_usd must not be negative")
        if self.max_input_tokens <= 0:
            raise ProviderConfigurationError("max_input_tokens must be positive")
        if self.max_output_tokens <= 0:
            raise ProviderConfigurationError("max_output_tokens must be positive")
        if self.input_cost_per_million < 0 or self.output_cost_per_million < 0:
            raise ProviderConfigurationError("token costs must not be negative")


class ChatProvider(ABC):
    """Boundary for provider-specific candidate generation."""

    @abstractmethod
    def generate(
        self,
        candidates: Sequence[Mapping[str, object]],
        bundle: Mapping[str, object],
    ) -> ProviderResult:
        """Return raw candidate parts and reported token usage."""


class FakeProvider(ChatProvider):
    """Credential-free deterministic provider for CI and focused tests."""

    def __init__(
        self,
        *,
        candidates: Sequence[Mapping[str, object]] | None = None,
        failure: ProviderFailure | None = None,
    ) -> None:
        self._candidates = [dict(candidate) for candidate in candidates or ()]
        self._failure = failure

    def generate(
        self,
        candidates: Sequence[Mapping[str, object]],
        bundle: Mapping[str, object],
    ) -> ProviderResult:
        del candidates, bundle
        if self._failure is not None:
            raise self._failure
        return ProviderResult(self._candidates, total_tokens=0)


class OpenAIChatProvider(ChatProvider):
    """Small Responses API adapter with injected credentials and no logging."""

    _RESPONSES_URL = "https://api.openai.com/v1/responses"

    def __init__(
        self,
        *,
        api_key: str,
        limits: ProviderLimits | None = None,
        transport: Transport | None = None,
    ) -> None:
        if not api_key.strip():
            raise ProviderConfigurationError("api_key must not be empty")
        self._api_key = api_key
        self._limits = limits or ProviderLimits()
        self._transport = transport or _post_json

    def generate(
        self,
        candidates: Sequence[Mapping[str, object]],
        bundle: Mapping[str, object],
    ) -> ProviderResult:
        input_value = json.dumps(
            {"candidates": [dict(candidate) for candidate in candidates], "bundle": dict(bundle)},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        # Every model token consumes at least one UTF-8 byte, so byte length is a safe upper bound.
        estimated_input_tokens = len(input_value.encode("utf-8"))
        if estimated_input_tokens > self._limits.max_input_tokens:
            raise ProviderFailure("limit-exceeded", retryable=False)
        self._ensure_projected_cost(estimated_input_tokens)

        body = json.dumps(
            {
                "model": self._limits.model,
                "input": input_value,
                "max_output_tokens": self._limits.max_output_tokens,
                "store": False,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        try:
            status, response = self._transport(
                self._RESPONSES_URL, body, headers, self._limits.timeout_seconds
            )
        except TimeoutError:
            raise ProviderFailure("provider-timeout", retryable=True) from None
        except (OSError, URLError, HTTPError):
            raise ProviderFailure("provider-unavailable", retryable=True) from None

        if status == 429:
            raise ProviderFailure("rate-limited", retryable=True)
        if status < 200 or status >= 300:
            raise ProviderFailure("provider-unavailable", retryable=True)
        return self._parse_response(response)

    def _ensure_projected_cost(self, input_tokens: int) -> None:
        projected = (
            input_tokens * self._limits.input_cost_per_million
            + self._limits.max_output_tokens * self._limits.output_cost_per_million
        ) / 1_000_000
        if projected > self._limits.cost_limit_usd:
            raise ProviderFailure("limit-exceeded", retryable=False)

    def _parse_response(self, response: bytes) -> ProviderResult:
        try:
            payload = json.loads(response)
            usage = payload["usage"]
            input_tokens = usage["input_tokens"]
            output_tokens = usage["output_tokens"]
            output = payload["output"]
            text = output[0]["content"][0]["text"]
        except (KeyError, IndexError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
            raise ProviderFailure("invalid-provider-output", retryable=False) from None
        if (
            not isinstance(input_tokens, int)
            or not isinstance(output_tokens, int)
            or input_tokens > self._limits.max_input_tokens
            or output_tokens > self._limits.max_output_tokens
        ):
            raise ProviderFailure("limit-exceeded", retryable=False)
        self._ensure_actual_cost(input_tokens, output_tokens)
        try:
            candidates = json.loads(text)
        except (TypeError, json.JSONDecodeError):
            raise ProviderFailure("invalid-provider-output", retryable=False) from None
        if not isinstance(candidates, list) or not all(
            isinstance(item, dict) for item in candidates
        ):
            raise ProviderFailure("invalid-provider-output", retryable=False)
        return ProviderResult(candidates, total_tokens=input_tokens + output_tokens)

    def _ensure_actual_cost(self, input_tokens: int, output_tokens: int) -> None:
        actual = (
            input_tokens * self._limits.input_cost_per_million
            + output_tokens * self._limits.output_cost_per_million
        ) / 1_000_000
        if actual > self._limits.cost_limit_usd:
            raise ProviderFailure("limit-exceeded", retryable=False)


def _post_json(url: str, body: bytes, headers: dict[str, str], timeout: float) -> tuple[int, bytes]:
    """Make the single network call without exposing request or response data."""
    request = Request(url, data=body, headers=headers, method="POST")
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed OpenAI endpoint
        return response.status, response.read()
