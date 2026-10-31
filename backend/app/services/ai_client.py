"""Bounded server-to-server client; no Gemini key or provider SDK in backend."""
import asyncio
from typing import Protocol

import httpx
from pydantic import ValidationError

from app.errors import ApiError
from app.models import AIRequest, AIResponse


class AIClient(Protocol):
    async def generate(self, request: AIRequest, delegation: str, request_id: str) -> AIResponse: ...


class HTTPAIClient:
    def __init__(self, settings):
        self.url = settings.ai_service_base_url.rstrip('/') + '/internal/v1/generate'
        self.token = settings.ai_service_token.get_secret_value()

    async def generate(self, request, delegation, request_id):
        try:
            return await asyncio.wait_for(self._request(request, delegation, request_id), timeout=25)
        except (asyncio.TimeoutError, httpx.TimeoutException):
            raise ApiError(504, 'AI_TIMEOUT', 'AI generation exceeded its time budget.', retryable=True) from None
        except (httpx.HTTPError, ValidationError, ValueError):
            raise ApiError(503, 'SERVICE_UNAVAILABLE', 'AI service is unavailable or returned an invalid response.', retryable=True) from None

    async def _request(self, request, delegation, request_id):
        headers = {'Authorization': 'Bearer ' + self.token, 'X-Delegation-Token': delegation, 'X-Request-ID': request_id, 'Content-Type': 'application/json'}
        async with httpx.AsyncClient(timeout=httpx.Timeout(25, connect=3), follow_redirects=False, trust_env=False) as client:
            async with client.stream('POST', self.url, json=request.model_dump(mode='json'), headers=headers) as response:
                if response.status_code == 504:
                    raise ApiError(504, 'AI_TIMEOUT', 'AI service exceeded its time budget.', retryable=True)
                if response.status_code != 200:
                    raise ApiError(503, 'SERVICE_UNAVAILABLE', 'AI service did not produce a valid generation result.', retryable=True)
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 256 * 1024:
                        raise ValueError('AI response exceeds contract size limit')
                return AIResponse.model_validate_json(bytes(data))
