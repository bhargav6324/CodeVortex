"""GoogleGeminiAdapter with a stand-in SDK client: no network, no API key."""

import asyncio
from types import SimpleNamespace

import pytest

from app.generation.prompt import RESPONSE_SCHEMA, PromptRequest
from app.llm.gemini import GoogleGeminiAdapter, ModelUnavailable

REQUEST = PromptRequest(system="SYSTEM", user="DATA:\n{}", response_schema=RESPONSE_SCHEMA)


class FakeModels:
    def __init__(self, behaviour):
        self.behaviour = behaviour
        self.calls = []

    async def generate_content(self, *, model, contents, config):
        self.calls.append(SimpleNamespace(model=model, contents=contents, config=config))
        return await self.behaviour()


def adapter_with(behaviour, model="gemini-test-model"):
    models = FakeModels(behaviour)
    client = SimpleNamespace(aio=SimpleNamespace(models=models))
    return GoogleGeminiAdapter(api_key="unused", model=model, client=client), models


def run(coro):
    return asyncio.run(coro)


def test_sends_structured_low_temperature_request():
    async def ok():
        return SimpleNamespace(text='{"x":1}', model_version="gemini-test-model-001")

    adapter, models = adapter_with(ok)
    reply = run(adapter.generate(REQUEST, timeout_s=5))

    assert reply.text == '{"x":1}' and reply.model_version == "gemini-test-model-001"
    (call,) = models.calls
    assert call.model == "gemini-test-model" and call.contents == "DATA:\n{}"
    assert call.config.system_instruction == "SYSTEM"
    assert call.config.temperature == 0.0
    assert call.config.response_mime_type == "application/json"
    assert call.config.response_json_schema == RESPONSE_SCHEMA
    assert call.config.max_output_tokens == 2048
    assert not call.config.tools


def test_model_version_falls_back_to_configured_identifier():
    async def ok():
        return SimpleNamespace(text="{}", model_version=None)

    adapter, _ = adapter_with(ok, model="gemini-configured")
    assert run(adapter.generate(REQUEST, timeout_s=5)).model_version == "gemini-configured"


def test_missing_text_becomes_empty_string_for_the_parser():
    async def blocked():
        return SimpleNamespace(text=None, model_version="m")

    adapter, _ = adapter_with(blocked)
    assert run(adapter.generate(REQUEST, timeout_s=5)).text == ""


def test_model_requested_tool_call_is_rejected_locally():
    async def wants_tool():
        return SimpleNamespace(text='{"x":1}', model_version="m", function_calls=[SimpleNamespace(name="send_email")])

    adapter, _ = adapter_with(wants_tool)
    assert run(adapter.generate(REQUEST, timeout_s=5)).text == ""


def test_timeout_is_model_unavailable():
    async def slow():
        await asyncio.sleep(5)

    adapter, _ = adapter_with(slow)
    with pytest.raises(ModelUnavailable, match="timed out"):
        run(adapter.generate(REQUEST, timeout_s=0.05))


def test_provider_error_is_redacted():
    class ClientError(Exception):
        code = 403

    async def fail():
        raise ClientError("API key AQ.secret-value is invalid for request DATA:...")

    adapter, _ = adapter_with(fail)
    with pytest.raises(ModelUnavailable) as exc:
        run(adapter.generate(REQUEST, timeout_s=5))
    assert "secret" not in str(exc.value) and "DATA" not in str(exc.value)
    assert exc.value.__cause__ is None
    assert "ClientError 403" in str(exc.value)


def test_cancellation_propagates():
    async def slow():
        await asyncio.sleep(5)

    adapter, _ = adapter_with(slow)

    async def cancel_soon():
        task = asyncio.create_task(adapter.generate(REQUEST, timeout_s=10))
        await asyncio.sleep(0.01)
        task.cancel()
        await task

    with pytest.raises(asyncio.CancelledError):
        run(cancel_soon())
