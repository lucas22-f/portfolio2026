"""Minimal Gmail SMTP adapter with bounded, payload-free failures."""

from __future__ import annotations

import smtplib
from collections.abc import Callable
from dataclasses import dataclass
from email.message import EmailMessage

from app.application.contact import ContactSubmission

SmtpFactory = Callable[..., smtplib.SMTP_SSL]


class ContactDeliveryConfigurationError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ContactDeliveryFailure(RuntimeError):
    category: str
    retryable: bool
    uncertain: bool = False


class GmailSmtpContactDelivery:
    host = "smtp.gmail.com"
    port = 465

    def __init__(
        self,
        email: str,
        app_password: str,
        *,
        timeout_seconds: float = 8.0,
        smtp_factory: SmtpFactory = smtplib.SMTP_SSL,
    ) -> None:
        if "@" not in email or not app_password.strip() or timeout_seconds <= 0:
            raise ContactDeliveryConfigurationError("contact delivery is unavailable")
        self._email = email
        self._app_password = app_password
        self._timeout = timeout_seconds
        self._smtp_factory = smtp_factory

    def deliver(self, submission: ContactSubmission) -> None:
        message = EmailMessage()
        message["From"] = self._email
        message["To"] = self._email
        message["Reply-To"] = submission.email
        message["Subject"] = "Portfolio interview contact"
        company = submission.company or "Not provided"
        message.set_content(
            f"Name: {submission.name}\nEmail: {submission.email}\n"
            f"Company: {company}\n\n{submission.message}"
        )

        try:
            with self._smtp_factory(self.host, self.port, timeout=self._timeout) as smtp:
                smtp.login(self._email, self._app_password)
                smtp.send_message(message, from_addr=self._email, to_addrs=(self._email,))
        except TimeoutError:
            raise ContactDeliveryFailure("timeout", retryable=False, uncertain=True) from None
        except (
            smtplib.SMTPAuthenticationError,
            smtplib.SMTPRecipientsRefused,
            smtplib.SMTPSenderRefused,
        ):
            raise ContactDeliveryFailure("permanent", retryable=False) from None
        except smtplib.SMTPResponseException as error:
            if 400 <= error.smtp_code < 500:
                raise ContactDeliveryFailure("transient", retryable=True) from None
            raise ContactDeliveryFailure("permanent", retryable=False) from None
        except (smtplib.SMTPException, OSError):
            raise ContactDeliveryFailure("network", retryable=True) from None
