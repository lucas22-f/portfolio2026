"""Validation and bounds for ephemeral chat conversation context."""

from __future__ import annotations

from collections.abc import Mapping

MAX_HISTORY_PAIRS = 6
MAX_USER_TURN_CHARS = 500
MAX_ASSISTANT_TURN_CHARS = 4000


def validate_history(value: object) -> list[dict[str, str]]:
    """Validate alternating, bounded user/assistant text pairs for provider context."""
    if not isinstance(value, list) or len(value) > MAX_HISTORY_PAIRS * 2 or len(value) % 2:
        raise ValueError("history must contain up to 6 complete user/assistant exchanges")
    validated: list[dict[str, str]] = []
    for index, item in enumerate(value):
        role = "user" if index % 2 == 0 else "assistant"
        limit = MAX_USER_TURN_CHARS if role == "user" else MAX_ASSISTANT_TURN_CHARS
        if (
            not isinstance(item, Mapping)
            or set(item) != {"role", "content"}
            or item.get("role") != role
            or not isinstance(item.get("content"), str)
            or not item["content"].strip()
            or len(item["content"]) > limit
        ):
            raise ValueError("history must contain bounded alternating user/assistant text")
        validated.append({"role": role, "content": item["content"]})
    return validated
