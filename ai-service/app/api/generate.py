"""POST /internal/v1/generate — the only operation the AI service exposes."""

from __future__ import annotations

import time
from typing import Callable

import httpx
from fastapi import APIRouter, Depends, Request

from app.contract.models import AIRequest, AIResponse
from app.http.auth import ServiceCaller, require_service_auth
from app.http.errors import ApiError
from app.http.request_context import current_request_id
from app.llm.gemini import GeminiAdapter, GoogleGeminiAdapter
from app.orchestrator import Budgets, run_turn
from app.settings import Settings, get_settings
from app.telemetry import TurnStats, emit, turn_record
from app.tools.client import HttpToolClient, ToolClient

router = APIRouter()

ToolClientFactory = Callable[[ServiceCaller], ToolClient]


def check_request_scope(req: AIRequest) -> None:
    """Body IDs and snapshot clocks must agree before any tool or model call."""
    if req.customer_id != req.context.customer.customer_id:
        raise ApiError("FORBIDDEN", "customer_id does not match the context snapshot.")
    if req.as_of != req.context.as_of:
        raise ApiError("FORBIDDEN", "as_of does not match the context snapshot.")


def get_tool_client_factory(request: Request, settings: Settings = Depends(get_settings)) -> ToolClientFactory:
    http: httpx.AsyncClient = request.app.state.http

    def make(caller: ServiceCaller) -> ToolClient:
        # Checked here, not in the dependency, so body and scope errors are reported first.
        if settings.backend_tool_token is None:
            raise ApiError("SERVICE_UNAVAILABLE", "Backend tool credential is not configured.")
        return HttpToolClient(
            http=http,
            base_url=settings.backend_tool_base_url,
            tool_token=settings.backend_tool_token.get_secret_value(),
            delegation_token=caller.delegation_token,
            request_id=current_request_id(),
            timeout_s=settings.tool_call_timeout_s,
        )

    return make


_adapters: dict[tuple[str, str], GoogleGeminiAdapter] = {}


def get_gemini(settings: Settings = Depends(get_settings)) -> tuple[GeminiAdapter | None, str | None]:
    """The configured adapter, or (None, None) when Gemini is not set up (turn reports unavailable)."""
    if settings.gemini_api_key is None or not settings.gemini_model:
        return None, None
    key = (settings.gemini_api_key.get_secret_value(), settings.gemini_model)
    if key not in _adapters:
        _adapters[key] = GoogleGeminiAdapter(api_key=key[0], model=key[1])
    return _adapters[key], settings.gemini_model


@router.post("/internal/v1/generate", response_model=AIResponse)
async def generate(
    req: AIRequest,
    caller: ServiceCaller = Depends(require_service_auth),
    make_tools: ToolClientFactory = Depends(get_tool_client_factory),
    gemini: tuple[GeminiAdapter | None, str | None] = Depends(get_gemini),
    settings: Settings = Depends(get_settings),
) -> AIResponse:
    check_request_scope(req)
    adapter, model_id = gemini
    stats = TurnStats()
    started = time.perf_counter()
    response: AIResponse | None = None
    error_code: str | None = None
    try:
        response = await run_turn(
            req,
            tools=make_tools(caller),
            gemini=adapter,
            model_id=model_id,
            budgets=Budgets(
                workflow_s=settings.workflow_budget_s,
                tool_call_s=settings.tool_call_timeout_s,
                gemini_total_s=settings.gemini_budget_s,
            ),
            stats=stats,
        )
        return response
    except ApiError as exc:
        error_code = exc.code
        raise
    except Exception:
        error_code = "INTERNAL_ERROR"
        raise
    finally:
        emit(
            turn_record(
                request_id=current_request_id(),
                turn_id=req.turn_id,
                customer_id=req.customer_id,
                stats=stats,
                duration_ms=round((time.perf_counter() - started) * 1000),
                response=response,
                error_code=error_code,
            ),
            settings.telemetry_path,
        )
