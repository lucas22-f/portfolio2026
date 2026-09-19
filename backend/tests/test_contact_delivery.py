from __future__ import annotations

import smtplib
from email.message import EmailMessage
from types import TracebackType
from typing import Self

import pytest

from app.application.contact import ContactSubmission
from app.infrastructure.contact_delivery import (
    ContactDeliveryConfigurationError,
    ContactDeliveryFailure,
    GmailSmtpContactDelivery,
)


def valid_submission() -> ContactSubmission:
    return ContactSubmission(
        submission_version="1",
        name="Ada Lovelace",
        email="ada@example.com",
        company=None,
        message="Interview request",
    )


class FakeSmtp:
    def __init__(self, failure: BaseException | None = None) -> None:
        self.failure = failure
        self.login_args: tuple[str, str] | None = None
        self.message: EmailMessage | None = None
        self.envelope: tuple[str, tuple[str, ...]] | None = None

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None

    def login(self, email: str, password: str) -> None:
        self.login_args = (email, password)

    def send_message(
        self, message: EmailMessage, *, from_addr: str, to_addrs: tuple[str, ...]
    ) -> None:
        if self.failure is not None:
            raise self.failure
        self.message = message
        self.envelope = (from_addr, to_addrs)


def test_gmail_smtp_uses_authenticated_inbox_and_visitor_reply_to() -> None:
    smtp = FakeSmtp()
    connection: dict[str, object] = {}

    def smtp_factory(host: str, port: int, *, timeout: float) -> FakeSmtp:
        connection.update(host=host, port=port, timeout=timeout)
        return smtp

    GmailSmtpContactDelivery(
        "owner@gmail.com",
        "app-password",
        smtp_factory=smtp_factory,  # type: ignore[arg-type]
    ).deliver(valid_submission())

    assert connection == {"host": "smtp.gmail.com", "port": 465, "timeout": 8.0}
    assert smtp.login_args == ("owner@gmail.com", "app-password")
    assert smtp.envelope == ("owner@gmail.com", ("owner@gmail.com",))
    assert smtp.message is not None
    assert smtp.message["From"] == "owner@gmail.com"
    assert smtp.message["To"] == "owner@gmail.com"
    assert smtp.message["Reply-To"] == "ada@example.com"
    assert smtp.message.get_content() == (
        "Name: Ada Lovelace\nEmail: ada@example.com\nCompany: Not provided\n\nInterview request\n"
    )
    assert "app-password" not in smtp.message.as_string()


@pytest.mark.parametrize(
    ("failure", "retryable", "uncertain"),
    [
        (smtplib.SMTPAuthenticationError(535, b"private"), False, False),
        (smtplib.SMTPSenderRefused(550, b"private", "owner@gmail.com"), False, False),
        (smtplib.SMTPRecipientsRefused({"owner@gmail.com": (550, b"private")}), False, False),
        (smtplib.SMTPConnectError(421, b"private"), True, False),
        (smtplib.SMTPConnectError(554, b"private"), False, False),
        (smtplib.SMTPDataError(451, b"private"), True, False),
        (smtplib.SMTPServerDisconnected("private"), True, False),
        (OSError("private"), True, False),
        (TimeoutError("private"), False, True),
    ],
)
def test_smtp_failures_are_bounded(
    failure: BaseException, retryable: bool, uncertain: bool
) -> None:
    smtp = FakeSmtp(failure)
    delivery = GmailSmtpContactDelivery(
        "owner@gmail.com",
        "app-password",
        smtp_factory=lambda *_args, **_kwargs: smtp,  # type: ignore[arg-type]
    )

    with pytest.raises(ContactDeliveryFailure) as captured:
        delivery.deliver(valid_submission())

    assert captured.value.retryable is retryable
    assert captured.value.uncertain is uncertain
    failure_text = repr(captured.value)
    assert "private" not in failure_text
    assert "app-password" not in failure_text


def test_missing_configuration_fails_without_identifying_the_secret() -> None:
    with pytest.raises(ContactDeliveryConfigurationError, match="unavailable"):
        GmailSmtpContactDelivery("owner@gmail.com", "")
