"""GeminiAdapter: the only code that touches the provider SDK. Nothing SDK-shaped leaves this module."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Protocol

from google import genai
from google.genai import types

from app.generation.prompt import PromptRequest


class ModelUnavailable(Exception):
    """The provider call failed or timed out. The message never contains credentials."""


@dataclass(frozen=True)
class ModelReply:
    text: str
    # Version reported by the provider, else the exact configured model identifier.
    model_version: str


class GeminiAdapter(Protocol):
    async def generate(self, request: PromptRequest, *, timeout_s: float) -> ModelReply: ...


class GoogleGeminiAdapter:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        temperature: float = 0.0,
        max_output_tokens: int = 2048,
        client: genai.Client | None = None,
    ) -> None:
        self._client = client or genai.Client(api_key=api_key)
        self._model = model
        self._temperature = temperature
        self._max_output_tokens = max_output_tokens

    async def generate(self, request: PromptRequest, *, timeout_s: float) -> ModelReply:
        config = types.GenerateContentConfig(
            system_instruction=request.system,
            temperature=self._temperature,
            max_output_tokens=self._max_output_tokens,
            response_mime_type="application/json",
            response_json_schema=request.response_schema,
            # No tools are offered to the model, so it cannot request any.
            tools=None,
        )
        try:
            resp = await asyncio.wait_for(
                self._client.aio.models.generate_content(model=self._model, contents=request.user, config=config),
                timeout=timeout_s,
            )
        except asyncio.TimeoutError as exc:
            raise ModelUnavailable("Gemini call timed out") from exc
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # SDK errors may echo request details; keep only the type and status.
            status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
            raise ModelUnavailable(f"Gemini call failed: {type(exc).__name__}{f' {status}' if status else ''}") from None

        if getattr(resp, "function_calls", None):
            # No tools are offered; a model-requested call is rejected locally as unusable output.
            return ModelReply(text="", model_version=resp.model_version or self._model)
        text = resp.text if isinstance(resp.text, str) else ""
        return ModelReply(text=text, model_version=resp.model_version or self._model)
