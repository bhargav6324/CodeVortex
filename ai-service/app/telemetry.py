"""Per-turn telemetry: one JSON line per generate call.

Holds IDs, outcome, codes, versions, counts and timing only. Never message text, prompts,
evidence values, customer records or credentials.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from app.contract.models import AIResponse

log = logging.getLogger("ai_service.turns")
_write_lock = threading.Lock()


@dataclass
class TurnStats:
    """Counters the orchestrator fills in while a turn runs."""

    tool_calls: int = 0
    gemini_attempts: int = 0
    gemini_ms: list[int] = field(default_factory=list)


def turn_record(
    *,
    request_id: str,
    turn_id: str | None,
    customer_id: str | None,
    stats: TurnStats,
    duration_ms: int,
    response: AIResponse | None = None,
    error_code: str | None = None,
) -> dict:
    record: dict = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "request_id": request_id,
        "turn_id": turn_id,
        "customer_id": customer_id,
        "outcome": response.generation_status if response else "error",
        "error_code": error_code,
        "tool_calls": stats.tool_calls,
        "gemini_attempts": stats.gemini_attempts,
        "gemini_ms": stats.gemini_ms,
        "duration_ms": duration_ms,
    }
    if response is not None:
        plan = response.plan
        record.update(
            segments=[s.code for s in plan.segments],
            objective=plan.strategy.objective if plan.strategy else None,
            template_id=plan.strategy.template_id if plan.strategy else None,
            selected_offer_id=plan.selected_offer_id,
            validation_passed=plan.validation.passed,
            finding_codes=[f.code for f in plan.validation.findings],
            validator_version=plan.validation.validator_version,
            evidence_fields=[e.field for e in response.evidence],
            prompt_version=response.prompt_version,
            model_version=response.model_version,
        )
    return record


def emit(record: dict, path: str | None) -> None:
    line = json.dumps(record, ensure_ascii=False)
    log.info(line)
    if not path:
        return
    target = Path(path)
    try:
        with _write_lock:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
    except OSError:
        # Telemetry must never break a turn.
        log.exception("could not write turn telemetry")
