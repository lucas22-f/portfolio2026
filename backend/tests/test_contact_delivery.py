from __future__ import annotations

import json
from contextlib import AbstractContextManager
from types import TracebackType
from typing import Self
from urllib.error import HTTPError, URLError
from urllib.request import Request

import pytest

from app.application.contact import ContactSubmission
from app.infrastructure.contact_delivery import (
    BrevoContactDelivery,
    ContactDeliveryConfigurationError,
    ContactDeliveryFailure,
)


def valid_submission() -> ContactSubmission:
    return ContactSubmission(
        submission_version="1",
        name="Ada Lovelace",
        email="ada@example.com",
        company=None,
        message="Interview request",
    )


class FakeResponse(AbstractContextManager[object]):
    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None


class FakeHttp:
    def __init__(self, failure: BaseException | None = None) -> None:
        self.failure = failure
        self.request: Request | None = None
        self.timeout: float | None = None

    def __call__(self, request: Request, *, timeout: float) -> AbstractContextManager[object]:
        if self.failure is not None:
            raise self.failure
        self.request = request
        self.timeout = timeout
        return FakeResponse()


def test_brevo_uses_verified_sender_recipient_and_visitor_reply_to() -> None:
    http = FakeHttp()

    BrevoContactDelivery(
        "private-api-key",
        "sender@example.com",
        "owner@example.com",
        http_client=http,
    ).deliver(valid_submission())

    assert http.timeout == 8.0
    assert http.request is not None
    assert http.request.full_url == "https://api.brevo.com/v3/smtp/email"
    assert http.request.get_method() == "POST"
    assert http.request.get_header("Api-key") == "private-api-key"
    assert http.request.get_header("Content-type") == "application/json"
    assert json.loads(http.request.data or b"{}") == {
        "sender": {"email": "sender@example.com"},
        "to": [{"email": "owner@example.com"}],
        "replyTo": {"email": "ada@example.com"},
        "subject": "Portfolio interview contact",
        "textContent": (
            "Name: Ada Lovelace\nEmail: ada@example.com\nCompany: Not provided\n\nInterview request"
        ),
    }


@pytest.mark.parametrize(
    ("failure", "retryable", "uncertain"),
    [
        (HTTPError("", 400, "private", None, None), False, False),
        (HTTPError("", 401, "private", None, None), False, False),
        (HTTPError("", 408, "private", None, None), True, False),
        (HTTPError("", 429, "private", None, None), True, False),
        (HTTPError("", 500, "private", None, None), True, False),
        (URLError("private"), True, False),
        (OSError("private"), True, False),
        (TimeoutError("private"), False, True),
    ],
)
def test_brevo_failures_are_bounded(
    failure: BaseException, retryable: bool, uncertain: bool
) -> None:
    delivery = BrevoContactDelivery(
        "private-api-key",
        "sender@example.com",
        "owner@example.com",
        http_client=FakeHttp(failure),
    )

    with pytest.raises(ContactDeliveryFailure) as captured:
        delivery.deliver(valid_submission())

    assert captured.value.retryable is retryable
    assert captured.value.uncertain is uncertain
    failure_text = repr(captured.value)
    assert "private" not in failure_text
    assert "private-api-key" not in failure_text


def test_missing_configuration_fails_without_identifying_the_secret() -> None:
    with pytest.raises(ContactDeliveryConfigurationError, match="unavailable"):
        BrevoContactDelivery("", "sender@example.com", "owner@example.com")
