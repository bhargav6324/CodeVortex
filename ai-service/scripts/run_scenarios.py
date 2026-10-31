"""Create real drafts through the backend and record what came back (Phase 4 live run).

Usage (from ai-service/, PowerShell):
    $env:REVIEWER_TOKEN = "<token from the backend team>"
    .venv/Scripts/python scripts/run_scenarios.py C001 C004 C008 C011 C014 C007 C019 C023 C036

The reviewer token is read from the environment only and never written anywhere.
Each draft response is appended to eval-data/runs.jsonl in the same record shape as the
AI service's turn log, so scripts/evaluate.py can score it. Failed calls keep the full
error code and message plus X-Request-ID for the backend team.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.contract.models import Draft, Error  # noqa: E402
from app.settings import Settings  # noqa: E402

OUT = ROOT / "eval-data" / "runs.jsonl"


def draft_record(draft: Draft, request_id: str, duration_ms: int) -> dict:
    status = {"ready_for_review": "generated"}.get(draft.status, draft.status)
    return {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "backend_draft",
        "request_id": request_id,
        "customer_id": draft.customer_id,
        "draft_id": draft.draft_id,
        "draft_status": draft.status,
        "outcome": status,
        "error_code": None,
        "segments": [s.code for s in draft.segments],
        "objective": draft.strategy.objective if draft.strategy else None,
        "template_id": draft.strategy.template_id if draft.strategy else None,
        "selected_offer_id": draft.selected_offer_id,
        "validation_passed": draft.validation.passed,
        "finding_codes": [f.code for f in draft.validation.findings],
        "evidence_fields": [e.field for e in draft.evidence],
        "model_version": draft.versions.model_version,
        "prompt_version": draft.versions.prompt_version,
        "gemini_attempts": 0 if draft.versions.model_version == "not_invoked" else 1,
        "duration_ms": duration_ms,
    }


def main(customers: list[str]) -> int:
    token = os.environ.get("REVIEWER_TOKEN")
    if not token or not customers:
        print(__doc__)
        return 1

    base = Settings().backend_tool_base_url.rstrip("/")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    failures = 0

    with httpx.Client(timeout=45) as http, OUT.open("a", encoding="utf-8") as out:
        for cid in customers:
            request_id = f"AIRUN_{cid}_{uuid.uuid4().hex[:8]}"
            headers = {
                "Authorization": f"Bearer {token}",
                "Idempotency-Key": f"airun_{cid}_{uuid.uuid4().hex}",
                "X-Request-ID": request_id,
                "Content-Type": "application/json",
            }
            started = time.perf_counter()
            try:
                resp = http.post(f"{base}/api/v1/drafts", json={"customer_id": cid, "channel": "email", "locale": "en-IN"}, headers=headers)
            except httpx.HTTPError as exc:
                print(f"{cid}: transport error {type(exc).__name__}  X-Request-ID={request_id}")
                failures += 1
                continue
            ms = round((time.perf_counter() - started) * 1000)
            rid = resp.headers.get("x-request-id", request_id)

            if resp.status_code in (200, 201):
                draft = Draft.model_validate_json(resp.content)
                rec = draft_record(draft, rid, ms)
                out.write(json.dumps(rec) + "\n")
                print(
                    f"{cid}: HTTP {resp.status_code} {draft.status:<16} objective={rec['objective']} "
                    f"segments={rec['segments']} findings={rec['finding_codes']} model={rec['model_version']} {ms} ms"
                )
            else:
                failures += 1
                try:
                    err = Error.model_validate_json(resp.content).error
                    detail = f"{err.code}: {err.message}"
                except Exception:
                    detail = resp.text[:300]
                out.write(json.dumps({"ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                                      "source": "backend_draft", "request_id": rid, "customer_id": cid, "outcome": "error",
                                      "error_code": detail.split(":")[0], "error_message": detail, "http_status": resp.status_code,
                                      "duration_ms": ms}) + "\n")
                print(f"{cid}: HTTP {resp.status_code} {detail}  X-Request-ID={rid}")

    print(f"\nRecorded to {OUT} ({failures} failure(s)).")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
