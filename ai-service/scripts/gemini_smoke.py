"""Live Gemini smoke test (needs network + GEMINI_API_KEY). Not part of the offline pytest suite.

Usage (from ai-service/):
    .venv/Scripts/python scripts/gemini_smoke.py [model ...]

Uses only the contract's own example data (seed CUST001, plan fields from the Draft example)
and checks Gemini returns exactly the contract's canonical message. Prints the actual model
version and run time so the result can be recorded.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.contract.models import Context, Message, Plan, Policy  # noqa: E402
from app.generation.candidate import CandidateError, parse_candidate  # noqa: E402
from app.generation.prompt import PROMPT_VERSION, build_turn_prompt  # noqa: E402
from app.llm.gemini import GoogleGeminiAdapter, ModelUnavailable  # noqa: E402
from app.settings import Settings  # noqa: E402

EXAMPLES = ROOT / "contract" / "examples"


def contract_inputs() -> tuple[Plan, Context, Policy, Message]:
    dataset = json.loads((EXAMPLES / "Dataset.json").read_text(encoding="utf-8"))
    draft = json.loads((EXAMPLES / "Draft.json").read_text(encoding="utf-8"))
    plan = Plan.model_validate(
        {
            "segments": draft["segments"],
            "strategy": draft["strategy"],
            "selected_offer_id": draft["selected_offer_id"],
            "eligibility": [],
            "validation": draft["validation"],
            "campaign_key": draft["campaign_key"],
        }
    )
    return (
        plan,
        Context.model_validate(dataset["customers"][0]),
        Policy.model_validate(dataset["policy"]),
        Message.model_validate(draft["message"]),
    )


async def run(model: str, settings: Settings) -> bool:
    plan, context, policy, expected = contract_inputs()
    turn = build_turn_prompt(plan, context, policy)
    adapter = GoogleGeminiAdapter(api_key=settings.gemini_api_key.get_secret_value(), model=model)

    started = time.perf_counter()
    try:
        reply = await adapter.generate(turn.request, timeout_s=settings.gemini_budget_s)
    except ModelUnavailable as exc:
        print(f"[{model}] UNAVAILABLE after {time.perf_counter() - started:.1f}s: {exc}")
        return False
    elapsed = time.perf_counter() - started

    try:
        candidate = parse_candidate(reply.text, turn.evidence_catalog)
    except CandidateError as exc:
        print(f"[{model}] model_version={reply.model_version} {elapsed:.1f}s PARSE FAIL: {exc}")
        return False

    exact = candidate.message == expected
    print(
        f"[{model}] model_version={reply.model_version} prompt={PROMPT_VERSION} {elapsed:.1f}s "
        f"exact_match={exact} evidence={[e.field for e in candidate.evidence]}"
    )
    if not exact:
        print("  got subject:", candidate.message.subject)
        print("  got body:   ", candidate.message.body.replace("\n", "\\n"))
    return exact


async def main(models: list[str]) -> int:
    settings = Settings()
    if settings.gemini_api_key is None:
        print("GEMINI_API_KEY is not set in .env")
        return 1
    models = models or [settings.gemini_model or "gemini-2.5-flash"]
    print(f"Live Gemini smoke test at {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    results = [await run(m, settings) for m in models]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
