"""Transcription uses fake providers and isolated in-memory budget only."""
import io
import wave
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.application.chat_admission import ChatAdmissionConfig, ChatAdmissionGuard
from app.application.chat_budget import BudgetDecision, InMemoryChatBudgetStore
import app.infrastructure.transcription_provider as transcription
from app.infrastructure.transcription_provider import TRANSCRIPTION_RESERVATION_USD
from app.main import create_app


def wav(seconds=1, channels=1, width=2, rate=16000):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(width)
        audio.setframerate(rate)
        audio.writeframes(b"\0" * (seconds * rate * channels * width))
    return output.getvalue()


def setup(cap=Decimal("5"), outcome="Texto editable"):
    store = InMemoryChatBudgetStore(cap, min(cap, Decimal("3")))
    provider = Mock()
    if isinstance(outcome, Exception):
        provider.transcribe.side_effect = outcome
    else:
        provider.transcribe.return_value = outcome
    app = create_app(service_token="fake-test-token", budget_store=store, transcription_provider=provider)
    return TestClient(app), store, provider


def post(client, audio, **kwargs):
    return client.post("/api/v1/chat/transcribe", content=audio,
                       headers={"Authorization": "Bearer fake-test-token", "Content-Type": "audio/wav"}, **kwargs)


@pytest.mark.parametrize("audio", [b"invalid", wav()[:-1], wav(31), wav(channels=2),
                                   wav(width=1), wav(rate=8000), b"x" * 3_000_001])
def test_invalid_audio_has_no_provider_or_budget_effect(audio):
    client, store, provider = setup()
    result = post(client, audio)
    assert result.status_code in (400, 413)
    assert result.json() == {"error": "invalid-audio"}
    provider.transcribe.assert_not_called()
    assert store.retained_count == 0
    assert store.reserve("probe", datetime.now(UTC), Decimal("5")) is BudgetDecision.ACCEPTED


def test_auth_and_type_fail_without_charging():
    client, store, provider = setup()
    for headers, expected in [({}, 401), ({"Authorization": "Bearer wrong"}, 401),
                              ({"Authorization": "Bearer fake-test-token", "Content-Type": "application/json"}, 415)]:
        result = client.post("/api/v1/chat/transcribe", content=wav(), headers=headers)
        assert result.status_code == expected
    provider.transcribe.assert_not_called()
    assert store.reserve("probe", datetime.now(UTC), Decimal("5")) is BudgetDecision.ACCEPTED


def test_transcript_is_returned_not_sent_and_full_reservation_is_retained():
    client, store, provider = setup(outcome="a" * 600)
    result = post(client, wav(30))
    assert result.status_code == 200
    assert result.json() == {"text": "a" * 600}
    provider.transcribe.assert_called_once()
    assert store.retained_count == 1
    assert store.reserve("probe", datetime.now(UTC), Decimal("5") - TRANSCRIPTION_RESERVATION_USD) is BudgetDecision.ACCEPTED
    assert store.reserve("over", datetime.now(UTC), Decimal("0.00000001")) is BudgetDecision.CAP_REACHED


def test_budget_denial_prevents_provider_call():
    client, store, provider = setup(cap=Decimal("0.000001"))
    result = post(client, wav())
    assert result.status_code == 429
    assert result.json() == {"error": "budget-exceeded"}
    provider.transcribe.assert_not_called()
    assert store.retained_count == 0


@pytest.mark.parametrize("outcome", [RuntimeError("secret payload"), "", None, "a" * 16001])
def test_uncertain_or_invalid_provider_output_retains_spend_and_hides_details(outcome):
    client, store, provider = setup(outcome=outcome)
    result = post(client, wav())
    assert result.status_code == 502
    assert result.json() == {"error": "transcription-unavailable"}
    assert store.retained_count == 1
    provider.transcribe.assert_called_once()


def test_unconfigured_transcription_fails_closed():
    client = TestClient(create_app(service_token="fake-test-token"))
    result = post(client, wav())
    assert result.status_code == 503
    assert result.json() == {"error": "transcription-unavailable"}


def test_invalid_audio_does_not_consume_admission_and_valid_audio_shares_rate_limit():
    provider = Mock(transcribe=Mock(return_value="Consulta"))
    guard = ChatAdmissionGuard(ChatAdmissionConfig(rate_limit=1, per_peer_concurrency=1))
    client = TestClient(create_app(service_token="fake-test-token", transcription_provider=provider,
                                 chat_admission=guard,
                                 budget_store=InMemoryChatBudgetStore(Decimal("5"), Decimal("3"))))
    assert post(client, b"bad").status_code == 400
    assert post(client, wav()).status_code == 200
    assert post(client, wav()).status_code == 429
    provider.transcribe.assert_called_once()


def test_unavailable_ledger_prevents_paid_call():
    provider = Mock()
    client = TestClient(create_app(service_token="fake-test-token", transcription_provider=provider))
    assert post(client, wav()).status_code == 503
    provider.transcribe.assert_not_called()


@pytest.mark.parametrize("offset,value", [(20, 3), (28, 1), (32, 4), (34, 8), (40, 2), (4, 1)])
def test_inconsistent_wav_headers_are_rejected_before_paid_call(offset, value):
    audio = bytearray(wav())
    audio[offset] = value
    client, store, provider = setup()
    assert post(client, bytes(audio)).status_code == 400
    provider.transcribe.assert_not_called()
    assert store.reserve("probe", datetime.now(UTC), Decimal("5")) is BudgetDecision.ACCEPTED


def test_adapter_uses_fixed_model_bounded_read_and_one_request(monkeypatch):
    reply = Mock()
    reply.__enter__ = Mock(return_value=reply)
    reply.__exit__ = Mock(return_value=False)
    reply.read.return_value = b'{"text":"Consulta"}'
    opener = Mock()
    opener.open.return_value = reply
    monkeypatch.setattr(transcription, "build_opener", lambda *_: opener)
    provider = transcription.OpenAITranscriptionProvider("fake-test-key")
    assert provider.transcribe(wav()) == "Consulta"
    request = opener.open.call_args.args[0]
    assert request.full_url == "https://api.openai.com/v1/audio/transcriptions"
    assert request.get_header("Authorization") == "Bearer fake-test-key"
    assert b"gpt-4o-mini-transcribe" in request.data
    assert opener.open.call_args.kwargs == {"timeout": 20}
    reply.read.assert_called_once_with(65_537)
    opener.open.assert_called_once()
    opener.open.reset_mock()
    opener.open.side_effect = RuntimeError("private upstream content")
    with pytest.raises(RuntimeError, match="^transcription unavailable$"):
        provider.transcribe(wav())
    opener.open.assert_called_once()
