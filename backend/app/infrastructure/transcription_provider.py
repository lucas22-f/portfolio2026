"""Bounded, one-shot OpenAI transcription; no audio persistence or payload logging."""
from __future__ import annotations

import io
import json
import struct
import uuid
import wave
from decimal import Decimal
from typing import Protocol
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_AUDIO_BYTES = 3_000_000
MAX_AUDIO_SECONDS = 30
MAX_TRANSCRIPT_CHARACTERS = 16_000
# Planning assumption, NOT a verified tariff: USD .003/minute, with a 10x
# safety factor, rounded up to a full minute for every <=30s request.
# Always retain this full amount, including success, rather than mispricing
# audio usage with the existing text-token prices. See backend README.
TRANSCRIPTION_RESERVATION_USD = Decimal("0.03")
TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe"


class TranscriptionProvider(Protocol):
    def transcribe(self, audio: bytes) -> str: ...


def validate_wav(audio: bytes) -> None:
    """Accept only canonical, uncompressed mono PCM16 WAV, with no extra chunks.

    Enforcing a single exact RIFF/fmt/data layout also prevents hidden/trailing
    payloads and ambiguous duration interpretations between WAV decoders.
    """
    if not 44 < len(audio) <= MAX_AUDIO_BYTES:
        raise ValueError("invalid audio")
    if (audio[:4] != b"RIFF" or audio[8:16] != b"WAVEfmt "
            or audio[36:40] != b"data"):
        raise ValueError("invalid audio")
    riff_size, = struct.unpack_from("<I", audio, 4)
    fmt_size, format_tag, channels, rate, byte_rate, alignment, bits = struct.unpack_from(
        "<IHHIIHH", audio, 16
    )
    data_size, = struct.unpack_from("<I", audio, 40)
    if (riff_size != len(audio) - 8 or fmt_size != 16 or format_tag != 1
            or channels != 1 or bits != 16 or not 16000 <= rate <= 48000
            or alignment != 2 or byte_rate != rate * 2
            or data_size != len(audio) - 44 or data_size % 2
            or not 0 < data_size <= MAX_AUDIO_SECONDS * rate * 2):
        raise ValueError("invalid audio")
    try:
        with wave.open(io.BytesIO(audio), "rb") as source:
            frames = source.getnframes()
            if (source.getcomptype() != "NONE" or source.getnchannels() != 1
                    or source.getsampwidth() != 2 or source.getframerate() != rate
                    or frames * 2 != data_size
                    or len(source.readframes(frames + 1)) != data_size):
                raise ValueError("invalid audio")
    except (wave.Error, EOFError) as error:
        raise ValueError("invalid audio") from error


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


class OpenAITranscriptionProvider:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        self._opener = build_opener(_NoRedirect())

    def transcribe(self, audio: bytes) -> str:
        validate_wav(audio)
        boundary = "portfolio-" + uuid.uuid4().hex
        prefix = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n"
            f"{TRANSCRIPTION_MODEL}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nes\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; "
            'name="file"; filename="audio.wav"\r\n'
            "Content-Type: audio/wav\r\n\r\n"
        ).encode()
        body = prefix + audio + f"\r\n--{boundary}--\r\n".encode()
        request = Request(
            "https://api.openai.com/v1/audio/transcriptions", data=body, method="POST",
            headers={"Authorization": f"Bearer {self._api_key}",
                     "Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        try:
            with self._opener.open(request, timeout=20) as response:
                raw = response.read(65_537)
                if len(raw) > 65_536:
                    raise ValueError("oversized response")
                payload = json.loads(raw)
                text = payload.get("text")
                if (
                    not isinstance(text, str)
                    or not text.strip()
                    or len(text) > MAX_TRANSCRIPT_CHARACTERS
                ):
                    raise ValueError("invalid response")
                return text
        except Exception:
            # Do not expose exception chains containing upstream bodies/headers.
            raise RuntimeError("transcription unavailable") from None
