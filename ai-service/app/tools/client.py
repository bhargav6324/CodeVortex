"""ToolClient: the AI service's only way to reach backend business rules.

Exactly two operations, both sent to POST {BACKEND_TOOL_BASE_URL}/internal/v1/tools/execute.
The URL and tool names are fixed here; nothing from the model or customer data can change them.
"""

from __future__ import annotations

from typing import Protocol

import httpx
from pydantic import TypeAdapter, ValidationError

from app.contract.models import (
    Error,
    EvaluateArguments,
    EvaluateToolRequest,
    EvaluateToolResponse,
    Message,
    Plan,
    ToolResponse,
    ValidateArguments,
    ValidateToolRequest,
    ValidateToolResponse,
    Validation,
)
from app.http.errors import ApiError

TOOL_PATH = "/internal/v1/tools/execute"
_TOOL_RESPONSE = TypeAdapter(ToolResponse)


class ToolTimeout(Exception):
    """A tool call exceeded its time limit. The orchestrator decides between retry budget and 504."""


class ToolClient(Protocol):
    async def evaluate_customer(self, *, turn_id: str, customer_id: str) -> Plan: ...

    async def validate_draft(
        self,
        *,
        turn_id: str,
        customer_id: str,
        message: Message,
        selected_offer_id: str | None,
        template_id: str,
    ) -> Validation: ...


class HttpToolClient:
    """Calls the backend tool gateway for one generation turn.

    One instance per turn: it carries that turn's delegation token and request ID.
    """

    def __init__(
        self,
        *,
        http: httpx.AsyncClient,
        base_url: str,
        tool_token: str,
        delegation_token: str,
        request_id: str,
        timeout_s: float,
    ) -> None:
        self._http = http
        self._url = base_url.rstrip("/") + TOOL_PATH
        self._headers = {
            "Authorization": f"Bearer {tool_token}",
            "X-Delegation-Token": delegation_token,
            "X-Request-ID": request_id,
            "Content-Type": "application/json",
        }
        self._timeout_s = timeout_s

    async def evaluate_customer(self, *, turn_id: str, customer_id: str) -> Plan:
        req = EvaluateToolRequest(
            tool="evaluate_customer", turn_id=turn_id, arguments=EvaluateArguments(customer_id=customer_id)
        )
        resp = await self._execute(req)
        assert isinstance(resp, EvaluateToolResponse)
        return resp.result

    async def validate_draft(
        self,
        *,
        turn_id: str,
        customer_id: str,
        message: Message,
        selected_offer_id: str | None,
        template_id: str,
    ) -> Validation:
        req = ValidateToolRequest(
            tool="validate_draft",
            turn_id=turn_id,
            arguments=ValidateArguments(
                customer_id=customer_id,
                message=message,
                selected_offer_id=selected_offer_id,
                template_id=template_id,
            ),
        )
        resp = await self._execute(req)
        assert isinstance(resp, ValidateToolResponse)
        return resp.result

    async def _execute(
        self, req: EvaluateToolRequest | ValidateToolRequest
    ) -> EvaluateToolResponse | ValidateToolResponse:
        try:
            raw = await self._http.post(
                self._url,
                content=req.model_dump_json(),
                headers=self._headers,
                timeout=self._timeout_s,
            )
        except httpx.TimeoutException as exc:
            raise ToolTimeout(req.tool) from exc
        except httpx.HTTPError as exc:
            raise ApiError("SERVICE_UNAVAILABLE", f"Backend tool {req.tool} is unreachable.", retryable=True) from exc

        if raw.status_code != 200:
            raise _backend_error(req.tool, raw)

        try:
            resp = _TOOL_RESPONSE.validate_json(raw.content)
        except ValidationError as exc:
            raise ApiError("SERVICE_UNAVAILABLE", f"Backend tool {req.tool} returned an invalid response.") from exc

        if resp.tool != req.tool or resp.turn_id != req.turn_id:
            raise ApiError("SERVICE_UNAVAILABLE", f"Backend tool {req.tool} answered for a different tool or turn.")
        return resp


def _backend_error(tool: str, raw: httpx.Response) -> ApiError:
    """Pass on the backend's error code and status, redacted: no backend message or details."""
    try:
        err = Error.model_validate_json(raw.content).error
    except ValidationError:
        return ApiError("SERVICE_UNAVAILABLE", f"Backend tool {tool} failed with HTTP {raw.status_code}.", retryable=raw.status_code >= 500)

    retry_after = raw.headers.get("Retry-After")
    return ApiError(
        err.code,
        f"Backend tool {tool} failed: {err.code}.",
        retryable=err.retryable,
        retry_after=int(retry_after) if retry_after and retry_after.isdigit() else None,
    )
