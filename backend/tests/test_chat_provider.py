import json

from app.infrastructure.chat_provider import OpenAIChatProvider, ProviderLimits, ToolCall


def test_grounded_call_uses_text_only_schema_and_server_owned_citations() -> None:
    received: dict[str, object] = {}

    def transport(_: str, body: bytes, __: dict[str, str], ___: float) -> tuple[int, bytes]:
        received["body"] = json.loads(body)
        return (
            200,
            b'{"output":[{"type":"message","content":[{"type":"output_text","text":"{\\"parts\\":[{\\"type\\":\\"text\\",\\"text\\":\\"Respuesta\\",\\"grounding\\":\\"portfolio\\"}]}"}]}],"usage":{"input_tokens":1,"output_tokens":1}}',
        )

    provider = OpenAIChatProvider(
        api_key="key", limits=ProviderLimits(model="test"), transport=transport
    )
    provider.generate(
        "consulta",
        {"chunks": [{"text": "evidence", "filename": "cv.pdf", "page": 1}]},
        ToolCall("consulta", "call-1", '{"query":"consulta"}'),
    )

    body = received["body"]
    assert isinstance(body, dict)
    variants = body["text"]["format"]["schema"]["properties"]["parts"]["items"]["anyOf"]
    assert variants[0]["required"] == ["type", "text", "grounding"]
    assert "citas de archivo y página las agrega el servidor" in body["instructions"]
