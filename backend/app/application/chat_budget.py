"""Shared monthly chat spend accounting and conservative reservation pricing."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, ROUND_CEILING
from enum import StrEnum
from typing import Protocol

import psycopg

_MICRODOLLAR = Decimal("0.00000001")
GPT5_MINI_INPUT = Decimal("0.25")
GPT5_MINI_OUTPUT = Decimal("2.00")


class BudgetDecision(StrEnum):
    ACCEPTED = "accepted"
    CAP_REACHED = "cap_reached"
    ALREADY_FINAL = "already_final"


class BudgetStoreUnavailable(RuntimeError):
    """The shared accounting result could not be confirmed."""


@dataclass(frozen=True, slots=True)
class BudgetConfig:
    monthly_cap_usd: Decimal = Decimal("5")
    warning_threshold_usd: Decimal = Decimal("3")
    input_cost_per_million: Decimal = GPT5_MINI_INPUT
    output_cost_per_million: Decimal = GPT5_MINI_OUTPUT
    max_input_tokens: int = 128_000
    max_output_tokens: int = 4_048

    def __post_init__(self) -> None:
        if not (Decimal(0) < self.warning_threshold_usd <= Decimal("3")):
            raise ValueError("warning threshold cannot exceed the approved USD 3 threshold")
        if not (Decimal(0) < self.monthly_cap_usd <= Decimal("5")):
            raise ValueError("monthly cap cannot exceed the approved USD 5 cap")
        if self.warning_threshold_usd > self.monthly_cap_usd:
            raise ValueError("warning threshold cannot exceed the monthly cap")
        if (not self.input_cost_per_million.is_finite() or not self.output_cost_per_million.is_finite()
                or self.input_cost_per_million <= 0 or self.output_cost_per_million <= 0):
            raise ValueError("token prices must be finite and positive")
        if min(self.max_input_tokens, self.max_output_tokens) <= 0:
            raise ValueError("token limits must be positive")

    @classmethod
    def from_environment(cls, env: Mapping[str, str], model: str) -> BudgetConfig:
        input_value = env.get("OPENAI_INPUT_COST_PER_MILLION")
        output_value = env.get("OPENAI_OUTPUT_COST_PER_MILLION")
        if model == "gpt-5-mini":
            input_price = Decimal(input_value or str(GPT5_MINI_INPUT))
            output_price = Decimal(output_value or str(GPT5_MINI_OUTPUT))
            if input_price < GPT5_MINI_INPUT or output_price < GPT5_MINI_OUTPUT:
                raise ValueError("gpt-5-mini token prices cannot be configured below published rates")
        else:
            if input_value is None or output_value is None:
                raise ValueError("token price environment variables are required for a model override")
            input_price, output_price = Decimal(input_value), Decimal(output_value)
        return cls(
            monthly_cap_usd=Decimal(env.get("CHAT_MONTHLY_BUDGET_USD", "5")),
            warning_threshold_usd=Decimal(env.get("CHAT_MONTHLY_WARNING_USD", "3")),
            input_cost_per_million=input_price,
            output_cost_per_million=output_price,
        )

    @property
    def turn_reservation_usd(self) -> Decimal:
        return money_cost(
            self.max_input_tokens,
            self.max_output_tokens,
            self.input_cost_per_million,
            self.output_cost_per_million,
        )


def money_cost(
    input_tokens: int,
    output_tokens: int,
    input_price: Decimal,
    output_price: Decimal,
) -> Decimal:
    if input_tokens < 0 or output_tokens < 0:
        raise ValueError("token counts cannot be negative")
    exact = (
        Decimal(input_tokens) * input_price + Decimal(output_tokens) * output_price
    ) / Decimal(1_000_000)
    return exact.quantize(_MICRODOLLAR, rounding=ROUND_CEILING)


def month_start_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("budget timestamps must be timezone-aware")
    utc = value.astimezone(UTC)
    return datetime(utc.year, utc.month, 1, tzinfo=UTC)


class ChatBudgetStore(Protocol):
    def reserve(self, reservation_id: str, at: datetime, amount: Decimal) -> BudgetDecision: ...

    def settle(
        self, reservation_id: str, input_tokens: int, output_tokens: int,
        input_price: Decimal, output_price: Decimal,
    ) -> tuple[bool, bool, bool]: ...

    def release(self, reservation_id: str) -> bool: ...

    def retain(self, reservation_id: str) -> None: ...


class PostgresChatBudgetStore:
    """Thin client for atomic, service-role-only PostgreSQL RPCs."""

    def __init__(self, database_url: str, config: BudgetConfig) -> None:
        if not database_url.strip():
            raise ValueError("SUPABASE_DB_URL is required")
        self._database_url = database_url
        self._config = config

    def _call(self, statement: str, params: tuple[object, ...]):
        try:
            with psycopg.connect(self._database_url, connect_timeout=5) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(statement, params)
                    return cursor.fetchone()
        except Exception as error:
            raise BudgetStoreUnavailable("shared chat budget database unavailable") from error

    def reserve(self, reservation_id: str, at: datetime, amount: Decimal) -> BudgetDecision:
        row = self._call(
            "SELECT app.reserve_chat_budget(%s, %s, %s, %s, %s)",
            (uuid.UUID(reservation_id), month_start_utc(at).date(), amount,
             self._config.monthly_cap_usd, self._config.warning_threshold_usd),
        )
        if not row or row[0] not in {"accepted", "cap_reached", "already_final"}:
            raise BudgetStoreUnavailable("shared chat budget reservation outcome unknown")
        return BudgetDecision(row[0])

    def settle(
        self, reservation_id: str, input_tokens: int, output_tokens: int,
        input_price: Decimal, output_price: Decimal,
    ) -> tuple[bool, bool, bool]:
        row = self._call(
            "SELECT * FROM app.settle_chat_budget(%s, %s, %s, %s, %s, %s)",
            (uuid.UUID(reservation_id), input_tokens, output_tokens, input_price, output_price,
             self._config.warning_threshold_usd),
        )
        if not row or len(row) != 3 or any(not isinstance(value, bool) for value in row):
            raise BudgetStoreUnavailable("shared chat budget settlement outcome unknown")
        return row[0], row[1], row[2]

    def release(self, reservation_id: str) -> bool:
        row = self._call("SELECT app.release_chat_budget(%s)", (uuid.UUID(reservation_id),))
        if not row:
            raise BudgetStoreUnavailable("shared chat budget release outcome unknown")
        return bool(row[0])

    def retain(self, reservation_id: str) -> None:
        row = self._call("SELECT app.retain_chat_budget(%s)", (uuid.UUID(reservation_id),))
        if not row or row[0] is not True:
            raise BudgetStoreUnavailable("shared chat budget retention outcome unknown")


class InMemoryChatBudgetStore:
    """Deterministic store for isolated tests; never selected by production startup."""

    def __init__(self, cap: Decimal, warning: Decimal) -> None:
        self._cap, self._warning = cap, warning
        self._lock = threading.Lock()
        self._months: dict[datetime, dict[str, object]] = {}
        self._reservations: dict[str, tuple[datetime, Decimal, str]] = {}
        self._over_reserved_reservations: set[str] = set()

    def reserve(self, reservation_id: str, at: datetime, amount: Decimal) -> BudgetDecision:
        month = month_start_utc(at)
        with self._lock:
            prior = self._reservations.get(reservation_id)
            if prior:
                if prior[0] != month or prior[1] != amount:
                    raise BudgetStoreUnavailable("reservation id reused with different parameters")
                return (
                    BudgetDecision.ACCEPTED
                    if prior[2] in {"reserved", "retained"}
                    else BudgetDecision.ALREADY_FINAL
                )
            state = self._months.setdefault(month, {"spent": Decimal(0), "warning": False})
            reserved = sum(
                value for period, value, status in self._reservations.values()
                if period == month and status in {"reserved", "retained"}
            )
            if Decimal(state["spent"]) + reserved + amount > self._cap:
                return BudgetDecision.CAP_REACHED
            self._reservations[reservation_id] = (month, amount, "reserved")
            return BudgetDecision.ACCEPTED

    def settle(self, reservation_id: str, input_tokens: int, output_tokens: int,
               input_price: Decimal, output_price: Decimal) -> tuple[bool, bool, bool]:
        with self._lock:
            entry = self._reservations.get(reservation_id)
            if entry is None:
                raise BudgetStoreUnavailable("reservation missing")
            month, reservation, status = entry
            if status == "settled":
                return True, False, reservation_id in self._over_reserved_reservations
            actual = money_cost(input_tokens, output_tokens, input_price, output_price)
            over_reservation = status == "released" or actual > reservation
            if over_reservation:
                self._over_reserved_reservations.add(reservation_id)
            state = self._months[month]
            state["spent"] = Decimal(state["spent"]) + actual
            warning = not bool(state["warning"]) and Decimal(state["spent"]) >= self._warning
            state["warning"] = bool(state["warning"]) or warning
            self._reservations[reservation_id] = (month, reservation, "settled")
            return True, warning, over_reservation

    def release(self, reservation_id: str) -> bool:
        with self._lock:
            entry = self._reservations.get(reservation_id)
            if entry is None or entry[2] in {"released", "settled"}:
                return False
            self._reservations[reservation_id] = (entry[0], entry[1], "released")
            return True

    def retain(self, reservation_id: str) -> None:
        with self._lock:
            entry = self._reservations.get(reservation_id)
            if entry:
                self._reservations[reservation_id] = (entry[0], entry[1], "retained")

    @property
    def retained_count(self) -> int:
        with self._lock:
            return sum(status == "retained" for _, _, status in self._reservations.values())


class UnavailableChatBudgetStore:
    def reserve(self, reservation_id: str, at: datetime, amount: Decimal) -> BudgetDecision:
        del reservation_id, at, amount
        raise BudgetStoreUnavailable("shared chat budget store is not configured")

    def settle(self, *args: object) -> tuple[bool, bool, bool]:
        del args
        raise BudgetStoreUnavailable("shared chat budget store is not configured")

    def release(self, *args: object) -> bool:
        del args
        raise BudgetStoreUnavailable("shared chat budget store is not configured")

    def retain(self, *args: object) -> None:
        del args
        raise BudgetStoreUnavailable("shared chat budget store is not configured")
