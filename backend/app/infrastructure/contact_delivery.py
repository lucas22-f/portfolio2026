"""Brevo transactional email adapter with bounded, payload-free failures."""

from __future__ import annotations

import json
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.application.contact import ContactSubmission

HttpClient = Callable[..., AbstractContextManager[object]]


class ContactDeliveryConfigurationError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ContactDeliveryFailure(RuntimeError):
    category: str
    retryable: bool
    uncertain: bool = False


def _open(request: Request, *, timeout: float) -> AbstractContextManager[object]:
    return urlopen(request, timeout=timeout)


class BrevoContactDelivery:
    endpoint = "https://api.brevo.com/v3/smtp/email"

    def __init__(
        self,
        api_key: str,
        sender_email: str,
        recipient_email: str,
        *,
        timeout_seconds: float = 8.0,
        http_client: HttpClient = _open,
    ) -> None:
        if (
            not api_key.strip()
            or "@" not in sender_email
            or "@" not in recipient_email
            or timeout_seconds <= 0
        ):
            raise ContactDeliveryConfigurationError("contact delivery is unavailable")
        self._api_key = api_key
        self._sender_email = sender_email
        self._recipient_email = recipient_email
        self._timeout = timeout_seconds
        self._http_client = http_client

    def deliver(self, submission: ContactSubmission) -> None:
        company = submission.company or "Not provided"
        payload = {
            "sender": {"email": self._sender_email},
            "to": [{"email": self._recipient_email}],
            "replyTo": {"email": submission.email},
            "subject": "Portfolio interview contact",
            "textContent": (
                f"Name: {submission.name}\nEmail: {submission.email}\n"
                f"Company: {company}\n\n{submission.message}"
            ),
        }
        request = Request(
            self.endpoint,
            data=json.dumps(payload).encode(),
            headers={"api-key": self._api_key, "content-type": "application/json"},
            method="POST",
        )

        try:
            with self._http_client(request, timeout=self._timeout):
                pass
        except TimeoutError:
            raise ContactDeliveryFailure("timeout", retryable=False, uncertain=True) from None
        except HTTPError as error:
            if error.code in {408, 429} or 500 <= error.code < 600:
                raise ContactDeliveryFailure("transient", retryable=True) from None
            raise ContactDeliveryFailure("permanent", retryable=False) from None
        except (URLError, OSError):
            raise ContactDeliveryFailure("network", retryable=True) from None
