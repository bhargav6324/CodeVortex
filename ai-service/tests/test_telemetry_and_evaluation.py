"""Telemetry content and the evaluation report, using only contract example values."""

import json

from fastapi.testclient import TestClient

from app.api.generate import get_gemini, get_tool_client_factory
from app.contract.models import DatasetLabel
from app.evaluation import evaluate, render_markdown
from app.main import create_app
from app.settings import Settings, get_settings
from tests.conftest import SERVICE_TOKEN, load_example
from tests.test_orchestrator import MODEL, FakeGemini, FakeTools, blocked, canonical, contract_plan, reply_json

GENERATE = "/internal/v1/generate"


def run_turn_over_http(tmp_path, ai_request_body, auth_headers, tools, gemini):
    log = tmp_path / "turns.jsonl"
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        ai_service_token=SERVICE_TOKEN, telemetry_path=str(log), _env_file=None
    )
    app.dependency_overrides[get_tool_client_factory] = lambda: (lambda caller: tools)
    app.dependency_overrides[get_gemini] = lambda: (gemini, MODEL)
    with TestClient(app) as client:
        resp = client.post(GENERATE, json=ai_request_body, headers={**auth_headers, "X-Request-ID": "REQ001"})
    return resp, [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]


def test_generated_turn_is_recorded_without_content(tmp_path, ai_request_body, auth_headers):
    resp, records = run_turn_over_http(
        tmp_path, ai_request_body, auth_headers, FakeTools(contract_plan()), FakeGemini(reply_json(canonical()))
    )
    assert resp.status_code == 200
    (rec,) = records
    assert rec["request_id"] == "REQ001" and rec["turn_id"] == "TURN001" and rec["customer_id"] == "CUST001"
    assert rec["outcome"] == "generated" and rec["error_code"] is None
    assert rec["segments"] == ["loyalty_candidate", "consistent"]
    assert rec["objective"] == "reward" and rec["template_id"] == "reward_v1"
    assert rec["tool_calls"] == 2 and rec["gemini_attempts"] == 1 and len(rec["gemini_ms"]) == 1
    assert rec["model_version"] == MODEL + "-001" and rec["prompt_version"] == "prompt_v1"

    text = json.dumps(rec)
    for secret_or_content in ["Asha", "Thank you", "INR 100", "Bearer", "delegation", SERVICE_TOKEN, "DATA:"]:
        assert secret_or_content not in text


def test_error_turn_is_recorded(tmp_path, ai_request_body, auth_headers):
    from app.http.errors import ApiError

    resp, records = run_turn_over_http(
        tmp_path, ai_request_body, auth_headers, FakeTools(contract_plan(), error=ApiError("FORBIDDEN", "x")), FakeGemini()
    )
    assert resp.status_code == 403
    (rec,) = records
    assert rec["outcome"] == "error" and rec["error_code"] == "FORBIDDEN" and rec["tool_calls"] == 1
    assert "segments" not in rec


def test_preblocked_turn_records_findings_and_no_model_call(tmp_path, ai_request_body, auth_headers):
    plan = contract_plan(strategy=None, selected_offer_id=None,
                         validation=blocked("CONSENT_REQUIRED", "consent.marketing_opt_in").model_dump(mode="json"))
    _, (rec,) = run_turn_over_http(tmp_path, ai_request_body, auth_headers, FakeTools(plan), FakeGemini())
    assert rec["outcome"] == "blocked" and rec["finding_codes"] == ["CONSENT_REQUIRED"]
    assert rec["gemini_attempts"] == 0 and rec["model_version"] == "not_invoked"


# --- evaluation ------------------------------------------------------------------------------


def seed_label() -> DatasetLabel:
    """The contract Dataset example's only label (CUST001)."""
    return DatasetLabel.model_validate(load_example("Dataset")["labels"][0])


def record(**overrides) -> dict:
    base = {
        "customer_id": "CUST001", "outcome": "generated", "error_code": None, "segments": ["loyalty_candidate", "consistent"],
        "objective": "reward", "finding_codes": [], "gemini_attempts": 1, "duration_ms": 1500,
        "model_version": MODEL, "prompt_version": "prompt_v1",
    }
    return {**base, **overrides}


def test_matching_turn_scores_full_marks():
    report = evaluate([seed_label()], [record()])
    (r,) = report.results
    assert r.segments_match and r.objective_match and r.block_correct
    assert report.per_segment["loyalty_candidate"] == {"precision": 1.0, "recall": 1.0, "support": 1}
    assert report.per_segment["dormant"]["precision"] is None


def test_latest_turn_wins_and_errors_are_ignored_for_scoring():
    turns = [record(segments=["consistent"]), record(), {"customer_id": "CUST001", "outcome": "error", "error_code": "AI_TIMEOUT", "duration_ms": 22000}]
    (r,) = evaluate([seed_label()], turns).results
    assert r.segments_match


def test_wrong_segments_and_unexpected_block_are_reported():
    (r,) = evaluate([seed_label()], [record(segments=["consistent"], outcome="blocked", finding_codes=["CONSENT_REQUIRED"])]).results
    assert not r.segments_match and not r.block_correct


def test_expected_block_needs_the_expected_codes():
    label = seed_label().model_copy(update={"expected_block_codes": ["CONSENT_REQUIRED"], "expected_objective": None})
    assert evaluate([label], [record(outcome="blocked", objective=None, finding_codes=["CONSENT_REQUIRED"])]).results[0].block_correct
    assert not evaluate([label], [record(outcome="blocked", objective=None, finding_codes=["CONTACT_FREQUENCY"])]).results[0].block_correct


def test_missing_turns_are_listed_not_scored():
    report = evaluate([seed_label()], [])
    assert report.results == [] and report.missing == ["CUST001"]
    md = render_markdown(report, generated_at="2026-10-31T00:00:00Z", labels_source="labels.json", turns_source="turns.jsonl")
    assert "0/1 (0%)" in md and "No recorded turn for: CUST001." in md and "n/a (0 cases)" in md


def test_report_lists_versions_errors_and_caveat():
    turns = [record(), {"customer_id": "CUST001", "outcome": "error", "error_code": "AI_TIMEOUT", "duration_ms": 22000}]
    md = render_markdown(evaluate([seed_label()], turns), generated_at="2026-10-31T00:00:00Z", labels_source="l.json", turns_source="t.jsonl")
    assert MODEL in md and "prompt_v1" in md and "AI_TIMEOUT ×1" in md
    assert "not a production accuracy claim" in md
    assert "| CUST001 |" in md and "| yes |" in md
