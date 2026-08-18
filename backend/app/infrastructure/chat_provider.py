"""Provider adapters with bounded, secret-safe OpenAI calls."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

Candidate = dict[str, object]

_CHAT_INSTRUCTIONS = (
    "Respondé en español. Podés conversar de forma general sin atribuir datos al "
    "portfolio. Si la persona pregunta por Lucas, su experiencia, formación, "
    "habilidades o proyectos, usá exclusivamente la herramienta search_portfolio "
    "antes de responder. No inventes datos ni referencias."
)
_GROUNDED_SPANISH_INSTRUCTIONS = (
    "Respondé en español. Usá únicamente la evidencia provista en la entrada; "
    "no inventes datos ni referencias. Devolvé solamente partes candidatas que "
    "cumplan el esquema solicitado. Para cada parte con grounding igual a "
    "portfolio, copiá record_ids y claim_ids exactamente desde records[].id y "
    "records[].claims[].claim_id de la evidencia: cada claim_id debe pertenecer "
    "al record_id citado en la misma parte. No cites IDs que no estén presentes "
    "ni combines claims de un record con otro. Si no podés responder una parte "
    "con una pareja record_id/claim_id exacta, no la presentes como portfolio: "
    "usá grounding general con record_ids y claim_ids vacíos."
)

_CANDIDATE_PARTS_SCHEMA: dict[str, object] = {
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
                            "record_ids": {"type": "array", "items": {"type": "string"}},
                            "claim_ids": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["type", "text", "grounding", "record_ids", "claim_ids"],
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
}

_SEARCH_PORTFOLIO_TOOL: dict[str, object] = {
    "type": "function",
    "name": "search_portfolio",
    "description": "Busca evidencia pública aprobada del portfolio de Lucas.",
    "strict": True,
    "parameters": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
        "additionalProperties": False,
    },
}


class ProviderResult(list[Candidate]):
    """Validated candidates with provider-reported token usage."""

    def __init__(
        self,
        candidates: Sequence[Mapping[str, object]],
        *,
        total_tokens: int,
        tool_call: ToolCall | None = None,
        total_input_tokens: int = 0,
        total_output_tokens: int = 0,
    ) -> None:
        super().__init__(dict(candidate) for candidate in candidates)
        self.total_tokens = total_tokens
        self.tool_call = tool_call
        self.total_input_tokens = total_input_tokens
        self.total_output_tokens = total_output_tokens


@dataclass(frozen=True, slots=True)
class ToolCall:
    """A validated, opaque continuation for one portfolio retrieval."""

    query: str
    call_id: str
    arguments: str


Transport = Callable[[str, bytes, dict[str, str], float], tuple[int, bytes]]


class ProviderConfigurationError(ValueError):
    """Raised when provider controls are unsafe or incomplete."""


class ProviderFailure(RuntimeError):
    """A recoverable provider error that never contains provider payloads."""

    def __init__(
        self,
        code: str,
        *,
        retryable: bool,
        diagnostic_category: str | None = None,
        diagnostic_metadata: Mapping[str, object] | None = None,
    ) -> None:
        self.code = code
        self.retryable = retryable
        self.diagnostic_category = diagnostic_category
        # This contains only a deliberately allow-listed Responses envelope summary.
        # It must never contain provider text, prompts, evidence, or raw payloads.
        self.diagnostic_metadata = dict(diagnostic_metadata or {})
        super().__init__(code)


def _http_failure(status: int) -> ProviderFailure:
    """Classify an HTTP outcome without retaining provider response data."""

    if status in {401, 403}:
        return ProviderFailure("provider-unavailable", retryable=True, diagnostic_category="auth")
    if status == 429:
        return ProviderFailure("rate-limited", retryable=True, diagnostic_category="rate-limit")
    if 400 <= status < 500:
        return ProviderFailure(
            "provider-unavailable", retryable=True, diagnostic_category="request-rejected"
        )
    return ProviderFailure("provider-unavailable", retryable=True, diagnostic_category="upstream")


def _parse_tool_call(raw_call: Mapping[str, object]) -> ToolCall:
    """Accept exactly the one strict search tool call supported by this boundary."""

    call_id = raw_call.get("call_id")
    name = raw_call.get("name")
    arguments = raw_call.get("arguments")
    if (
        not isinstance(call_id, str)
        or not call_id
        or name != "search_portfolio"
        or not isinstance(arguments, str)
    ):
        raise ProviderFailure("invalid-provider-output", retryable=False)
    try:
        parsed = json.loads(arguments)
    except json.JSONDecodeError:
        raise ProviderFailure("invalid-provider-output", retryable=False) from None
    if (
        not isinstance(parsed, dict)
        or set(parsed) != {"query"}
        or not isinstance(parsed["query"], str)
        or not parsed["query"].strip()
        or len(parsed["query"]) > 500
    ):
        raise ProviderFailure("invalid-provider-output", retryable=False)
    return ToolCall(query=parsed["query"], call_id=call_id, arguments=arguments)


def _safe_diagnostic_label(value: object) -> str | None:
    """Return a bounded protocol label, never arbitrary provider text."""

    if not isinstance(value, str) or len(value) > 64:
        return None
    if not value.replace("-", "").replace("_", "").isalnum():
        return None
    return value


def _response_diagnostic_metadata(payload: Mapping[str, object]) -> dict[str, object]:
    """Extract the non-sensitive shape needed to diagnose no-text Responses."""

    metadata: dict[str, object] = {}
    status = _safe_diagnostic_label(payload.get("status"))
    if status is not None:
        metadata["status"] = status

    incomplete_details = payload.get("incomplete_details")
    if isinstance(incomplete_details, Mapping):
        reason = _safe_diagnostic_label(incomplete_details.get("reason"))
        if reason is not None:
            metadata["incomplete_reason"] = reason

    provider_error = payload.get("error")
    if isinstance(provider_error, Mapping):
        error_code = _safe_diagnostic_label(provider_error.get("code"))
        if error_code is not None:
            metadata["error_code"] = error_code

    output = payload.get("output")
    if isinstance(output, list):
        item_types: list[str] = []
        content_types: list[list[str]] = []
        for item in output:
            if not isinstance(item, Mapping):
                continue
            item_type = _safe_diagnostic_label(item.get("type"))
            if item_type is not None:
                item_types.append(item_type)
            item_content_types: list[str] = []
            content = item.get("content")
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, Mapping):
                        content_type = _safe_diagnostic_label(part.get("type"))
                        if content_type is not None:
                            item_content_types.append(content_type)
            content_types.append(item_content_types)
        metadata["output_item_types"] = item_types
        metadata["output_content_types"] = content_types

    usage = payload.get("usage")
    if isinstance(usage, Mapping):
        token_breakdown: dict[str, int] = {}
        for key in ("input_tokens", "output_tokens", "total_tokens"):
            value = usage.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                token_breakdown[key] = value
        for group in ("input_tokens_details", "output_tokens_details"):
            details = usage.get(group)
            if isinstance(details, Mapping):
                for key, value in details.items():
                    if (
                        isinstance(key, str)
                        and len(key) <= 64
                        and key.replace("_", "").isalnum()
                        and isinstance(value, int)
                        and not isinstance(value, bool)
                        and value >= 0
                    ):
                        token_breakdown[f"{group}.{key}"] = value
        metadata["usage_tokens"] = token_breakdown
    return metadata


@dataclass(frozen=True, slots=True)
class ProviderLimits:
    """Explicit aggregate per-request controls, configured at application startup."""

    model: str = "gpt-5-mini"
    timeout_seconds: float = 15.0
    cost_limit_usd: float = 0.05
    max_input_tokens: int = 4_000
    # A portfolio answer may make two Responses API calls. This is their combined cap.
    max_output_tokens: int = 1_024
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
        message: str,
        evidence: Mapping[str, object] | None = None,
        tool_call: ToolCall | None = None,
        prior_input_tokens: int = 0,
        prior_output_tokens: int = 0,
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
        message: str,
        evidence: Mapping[str, object] | None = None,
        tool_call: ToolCall | None = None,
        prior_input_tokens: int = 0,
        prior_output_tokens: int = 0,
    ) -> ProviderResult:
        del message, evidence, tool_call, prior_input_tokens, prior_output_tokens
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
        message: str,
        evidence: Mapping[str, object] | None = None,
        tool_call: ToolCall | None = None,
        prior_input_tokens: int = 0,
        prior_output_tokens: int = 0,
    ) -> ProviderResult:
        if prior_input_tokens < 0 or prior_output_tokens < 0:
            raise ProviderFailure("invalid-provider-output", retryable=False)
        input_value: object = message
        instructions = _CHAT_INSTRUCTIONS
        tools: list[dict[str, object]] | None = [_SEARCH_PORTFOLIO_TOOL]
        # The initial call also answers general questions, so it retains its
        # 512-token allowance. A grounded follow-up receives only the unspent
        # portion of the 1,024-token aggregate request budget.
        remaining_output_tokens = self._limits.max_output_tokens - prior_output_tokens
        max_output_tokens = (
            remaining_output_tokens
            if tool_call is not None
            else min(512, remaining_output_tokens)
        )
        if max_output_tokens <= 0:
            raise ProviderFailure("limit-exceeded", retryable=False)
        if tool_call is not None:
            if evidence is None:
                raise ProviderFailure("invalid-provider-output", retryable=False)
            input_value = [
                {"role": "user", "content": message},
                {
                    "type": "function_call",
                    "call_id": tool_call.call_id,
                    "name": "search_portfolio",
                    "arguments": tool_call.arguments,
                },
                {
                    "type": "function_call_output",
                    "call_id": tool_call.call_id,
                    "output": json.dumps(dict(evidence), ensure_ascii=False, separators=(",", ":")),
                },
            ]
            instructions = _GROUNDED_SPANISH_INSTRUCTIONS
            tools = None
        elif evidence is not None:
            raise ProviderFailure("invalid-provider-output", retryable=False)
        encoded_input = json.dumps(input_value, ensure_ascii=False, separators=(",", ":"))
        # Every model token consumes at least one UTF-8 byte, so byte length is a safe upper bound.
        estimated_input_tokens = len(encoded_input.encode("utf-8"))
        prior_tokens = prior_input_tokens + prior_output_tokens
        if prior_tokens + estimated_input_tokens > self._limits.max_input_tokens:
            raise ProviderFailure("limit-exceeded", retryable=False)
        self._ensure_projected_cost(
            prior_input_tokens + estimated_input_tokens,
            prior_output_tokens + max_output_tokens,
        )

        body = json.dumps(
            {
                "model": self._limits.model,
                "instructions": instructions,
                "input": input_value,
                "max_output_tokens": max_output_tokens,
                "reasoning": {"effort": "low"},
                "store": False,
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "candidate_parts",
                        "strict": True,
                        "schema": _CANDIDATE_PARTS_SCHEMA,
                    }
                },
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        if tools is not None:
            body_payload = json.loads(body)
            body_payload["tools"] = tools
            body = json.dumps(body_payload, ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            )
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        try:
            status, response = self._transport(
                self._RESPONSES_URL, body, headers, self._limits.timeout_seconds
            )
        except TimeoutError:
            raise ProviderFailure(
                "provider-timeout", retryable=True, diagnostic_category="transport"
            ) from None
        except HTTPError as error:
            raise _http_failure(error.code) from None
        except (OSError, URLError):
            raise ProviderFailure(
                "provider-unavailable", retryable=True, diagnostic_category="transport"
            ) from None

        if status < 200 or status >= 300:
            raise _http_failure(status)
        return self._parse_response(
            response,
            prior_input_tokens=prior_input_tokens,
            prior_output_tokens=prior_output_tokens,
            expect_tool_result=tool_call is not None,
        )

    def _ensure_projected_cost(self, input_tokens: int, output_tokens: int) -> None:
        projected = (
            input_tokens * self._limits.input_cost_per_million
            + output_tokens * self._limits.output_cost_per_million
        ) / 1_000_000
        if projected > self._limits.cost_limit_usd:
            raise ProviderFailure("limit-exceeded", retryable=False)

    def _parse_response(
        self,
        response: bytes,
        *,
        prior_input_tokens: int,
        prior_output_tokens: int,
        expect_tool_result: bool,
    ) -> ProviderResult:
        diagnostic_metadata: dict[str, object] = {}
        try:
            payload = json.loads(response)
            if not isinstance(payload, Mapping):
                raise TypeError("response payload must be an object")
            diagnostic_metadata = _response_diagnostic_metadata(payload)
            usage = payload["usage"]
            input_tokens = usage["input_tokens"]
            output_tokens = usage["output_tokens"]
            output = payload["output"]
            function_calls = [
                item
                for item in output
                if isinstance(item, Mapping) and item.get("type") == "function_call"
            ]
            text_parts = [
                content["text"]
                for item in output
                if isinstance(item, Mapping)
                for content in item.get("content", ())
                if isinstance(content, Mapping) and content.get("type") == "output_text"
            ]
        except (
            KeyError,
            TypeError,
            UnicodeDecodeError,
            json.JSONDecodeError,
        ):
            raise ProviderFailure(
                "invalid-provider-output",
                retryable=False,
                diagnostic_category="response-envelope-invalid",
                diagnostic_metadata=diagnostic_metadata,
            ) from None
        try:
            if (
                not isinstance(input_tokens, int)
                or not isinstance(output_tokens, int)
                or input_tokens < 0
                or output_tokens < 0
                or prior_input_tokens + prior_output_tokens + input_tokens
                > self._limits.max_input_tokens
                or prior_output_tokens + output_tokens > self._limits.max_output_tokens
            ):
                raise ProviderFailure("limit-exceeded", retryable=False)
            total_input_tokens = prior_input_tokens + input_tokens
            total_output_tokens = prior_output_tokens + output_tokens
            self._ensure_actual_cost(total_input_tokens, total_output_tokens)
            total_tokens = total_input_tokens + total_output_tokens
            if function_calls:
                if expect_tool_result:
                    raise ProviderFailure(
                        "invalid-provider-output",
                        retryable=False,
                        diagnostic_category="unexpected-function-call-after-tool-output",
                    )
                if len(function_calls) != 1 or text_parts:
                    raise ProviderFailure(
                        "invalid-provider-output",
                        retryable=False,
                        diagnostic_category="unexpected-function-call",
                    )
                tool_call = _parse_tool_call(function_calls[0])
                return ProviderResult(
                    [],
                    total_tokens=total_tokens,
                    tool_call=tool_call,
                    total_input_tokens=total_input_tokens,
                    total_output_tokens=total_output_tokens,
                )
            if not text_parts:
                raise ProviderFailure(
                    "invalid-provider-output",
                    retryable=False,
                    diagnostic_category="missing-output-text",
                )
            if len(text_parts) != 1:
                raise ProviderFailure(
                    "invalid-provider-output",
                    retryable=False,
                    diagnostic_category="multiple-output-text",
                )
            try:
                structured_output = json.loads(text_parts[0])
            except (TypeError, json.JSONDecodeError):
                raise ProviderFailure(
                    "invalid-provider-output",
                    retryable=False,
                    diagnostic_category="output-text-json-parse-failed",
                ) from None
            if (
                not isinstance(structured_output, dict)
                or set(structured_output) != {"parts"}
                or not isinstance(structured_output["parts"], list)
            ):
                raise ProviderFailure(
                    "invalid-provider-output",
                    retryable=False,
                    diagnostic_category="invalid-structured-parts-shape",
                )
            candidates = structured_output["parts"]
            if not all(isinstance(item, dict) for item in candidates):
                raise ProviderFailure(
                    "invalid-provider-output",
                    retryable=False,
                    diagnostic_category="invalid-structured-parts-shape",
                )
            return ProviderResult(
                candidates,
                total_tokens=total_tokens,
                total_input_tokens=total_input_tokens,
                total_output_tokens=total_output_tokens,
            )
        except ProviderFailure as error:
            if not error.diagnostic_metadata:
                error.diagnostic_metadata = diagnostic_metadata
            raise

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
