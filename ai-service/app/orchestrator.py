"""One generation turn: evaluate_customer -> Gemini (<= 2 attempts) -> validate_draft -> AIResponse.

Bounded and linear: at most two tool calls, at most two model attempts, no agent loop.
Business decisions come from the backend tools; this module only sequences them.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable, TypeVar

from app.contract.models import AIRequest, AIResponse, Finding, Plan, Validation
from app.generation.candidate import Candidate, CandidateError, parse_candidate
from app.generation.prompt import PROMPT_VERSION, TurnPrompt, build_turn_prompt
from app.generation.templates import TemplateError
from app.http.errors import ApiError
from app.llm.gemini import GeminiAdapter, ModelUnavailable
from app.telemetry import TurnStats
from app.tools.client import ToolClient, ToolTimeout

NOT_INVOKED = "not_invoked"
LOCAL_VALIDATOR_VERSION = "ai_service_v1"
MAX_MODEL_ATTEMPTS = 2

T = TypeVar("T")


@dataclass(frozen=True)
class Budgets:
    workflow_s: float = 22.0
    tool_call_s: float = 3.0
    gemini_total_s: float = 15.0


class _Deadline:
    def __init__(self, seconds: float) -> None:
        self._loop = asyncio.get_running_loop()
        self._end = self._loop.time() + seconds

    def remaining(self) -> float:
        return self._end - self._loop.time()


async def run_turn(
    req: AIRequest,
    *,
    tools: ToolClient,
    gemini: GeminiAdapter | None,
    model_id: str | None,
    budgets: Budgets = Budgets(),
    stats: TurnStats | None = None,
) -> AIResponse:
    stats = stats if stats is not None else TurnStats()
    try:
        async with asyncio.timeout(budgets.workflow_s):
            response = await _turn(req, tools, gemini, model_id, budgets, _Deadline(budgets.workflow_s), stats)
    except TimeoutError:
        raise ApiError("AI_TIMEOUT", "Generation exceeded the time budget.", retryable=True) from None
    check_consistent(response)
    return response


async def _turn(
    req: AIRequest,
    tools: ToolClient,
    gemini: GeminiAdapter | None,
    model_id: str | None,
    budgets: Budgets,
    deadline: _Deadline,
    stats: TurnStats,
) -> AIResponse:
    plan = await _tool_call(
        lambda: tools.evaluate_customer(turn_id=req.turn_id, customer_id=req.customer_id), budgets, deadline, stats
    )
    _check_plan(plan)

    if not plan.validation.passed:
        # Pre-blocked by deterministic rules: Gemini is never called.
        return _response(req, plan, status="blocked", model_version=NOT_INVOKED)

    try:
        turn = build_turn_prompt(plan, req.context, req.policy)
    except TemplateError as exc:
        blocked = plan.model_copy(update={"validation": _local_block("POLICY_MISMATCH", "strategy.template_id", str(exc))})
        return _response(req, blocked, status="blocked", model_version=NOT_INVOKED)

    if gemini is None or model_id is None:
        return _response(req, plan, status="unavailable", model_version=NOT_INVOKED)

    candidate, model_version = await _generate(turn, gemini, model_id, budgets, deadline, stats)
    if candidate is None:
        return _response(req, plan, status="unavailable", model_version=model_version)

    validation = await _tool_call(
        lambda: tools.validate_draft(
            turn_id=req.turn_id,
            customer_id=req.customer_id,
            message=candidate.message,
            selected_offer_id=plan.selected_offer_id,
            template_id=turn.template_id,
        ),
        budgets,
        deadline,
        stats,
    )
    _check_validation(validation)
    plan = plan.model_copy(update={"validation": validation})

    if not validation.passed:
        # A failed candidate stays visible as a blocked draft; no unvalidated evidence is returned.
        return _response(req, plan, status="blocked", model_version=model_version, message=candidate.message)
    return _response(
        req, plan, status="generated", model_version=model_version, message=candidate.message, candidate=candidate
    )


async def _generate(
    turn: TurnPrompt, gemini: GeminiAdapter, model_id: str, budgets: Budgets, deadline: _Deadline, stats: TurnStats
) -> tuple[Candidate | None, str]:
    """At most two model attempts sharing one Gemini budget; the second is the single repair."""
    loop = asyncio.get_running_loop()
    gemini_end = loop.time() + budgets.gemini_total_s
    request = turn.request
    model_version = model_id

    for attempt in range(MAX_MODEL_ATTEMPTS):
        # Keep enough time for the validate_draft call that must follow.
        allowed = min(gemini_end - loop.time(), deadline.remaining() - budgets.tool_call_s)
        if allowed <= 0:
            if attempt == 0:
                raise TimeoutError
            break
        stats.gemini_attempts += 1
        started = loop.time()
        try:
            reply = await gemini.generate(request, timeout_s=allowed)
        except ModelUnavailable:
            continue  # the second attempt retries the same request
        finally:
            stats.gemini_ms.append(round((loop.time() - started) * 1000))
        model_version = reply.model_version
        try:
            return parse_candidate(reply.text, turn.evidence_catalog), model_version
        except CandidateError as exc:
            request = turn.repair(str(exc))
    return None, model_version


async def _tool_call(
    call: Callable[[], Awaitable[T]], budgets: Budgets, deadline: _Deadline, stats: TurnStats
) -> T:
    remaining = deadline.remaining()
    if remaining <= 0:
        raise TimeoutError
    stats.tool_calls += 1
    try:
        return await asyncio.wait_for(call(), timeout=min(budgets.tool_call_s, remaining))
    except (ToolTimeout, TimeoutError):
        if deadline.remaining() <= 0:
            raise TimeoutError from None
        raise ApiError("SERVICE_UNAVAILABLE", "Backend tool call timed out.", retryable=True) from None


def _blocking(validation: Validation) -> list[Finding]:
    return [f for f in validation.findings if f.severity == "block"]


def _check_validation(validation: Validation) -> None:
    """The contract ties `passed` to findings; a tool that breaks that cannot be trusted."""
    if validation.passed == bool(_blocking(validation)):
        raise ApiError("SERVICE_UNAVAILABLE", "Backend tool returned an inconsistent validation.")


def _check_plan(plan: Plan) -> None:
    _check_validation(plan.validation)
    if plan.validation.passed and plan.strategy is None:
        raise ApiError("SERVICE_UNAVAILABLE", "Backend tool returned a passing plan without a strategy.")


def _local_block(code: str, field: str | None, message: str) -> Validation:
    return Validation(
        passed=False,
        findings=[Finding(code=code, severity="block", field=field, message=message[:500])],
        checked_at=datetime.now(timezone.utc),
        validator_version=LOCAL_VALIDATOR_VERSION,
    )


def _response(
    req: AIRequest,
    plan: Plan,
    *,
    status: str,
    model_version: str,
    message=None,
    candidate: Candidate | None = None,
) -> AIResponse:
    return AIResponse(
        turn_id=req.turn_id,
        plan=plan,
        message=message,
        evidence=candidate.evidence if candidate is not None else [],
        generation_status=status,
        prompt_version=PROMPT_VERSION,
        model_version=model_version,
    )


def check_consistent(resp: AIResponse) -> None:
    """Never hand the backend a response that breaks the contract's status rules."""
    v = resp.plan.validation
    ok = {
        "generated": resp.message is not None and resp.plan.strategy is not None and v.passed and not _blocking(v),
        "blocked": not v.passed and bool(_blocking(v)) and not resp.evidence,
        "unavailable": resp.message is None and not resp.evidence,
    }[resp.generation_status]
    if not ok:
        raise ApiError("INTERNAL_ERROR", "Generation produced an inconsistent response.")
