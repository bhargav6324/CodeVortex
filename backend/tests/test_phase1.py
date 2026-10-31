import json
import re
import time
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError

from app import models
from app.auth import DelegationClaims, issue_delegation
from app.main import create_app

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = json.loads((ROOT / "contracts/schema.json").read_text())
REQUEST = {"customer_id": "CUST001", "channel": "email", "locale": "en-IN"}


def validate_contract(name, value):
    Draft202012Validator({"$ref": "#/$defs/" + name, "$defs": REGISTRY["$defs"]}, format_checker=FormatChecker()).validate(value)


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    body = response.json()
    validate_contract("Error", body)
    assert body["error"]["code"] == code
    assert body["error"]["request_id"] == response.headers["x-request-id"]
    assert response.headers["x-contract-version"] == "1.0.0"
    assert response.headers["cache-control"] == "no-store"


def test_health_and_openapi(client):
    response = client.get("/health", headers={"X-Request-ID": "health_1"})
    assert response.status_code == 200
    validate_contract("Health", response.json())
    assert response.headers["x-request-id"] == "health_1"
    paths = client.get("/openapi.json").json()["paths"]
    assert set(paths) == {"/health", "/api/v1/customers/{customer_id}/context", "/api/v1/drafts",
                          "/api/v1/drafts/{draft_id}", "/api/v1/drafts/{draft_id}/review", "/internal/v1/tools/execute"}
    assert paths["/api/v1/drafts"]["post"]["security"]


def test_auth_scope_and_unimplemented_routes(client, reviewer_headers, settings):
    assert_error(client.get("/api/v1/customers/CUST001/context"), 401, "UNAUTHORIZED")
    for token in ["invalid", settings.backend_tool_token.get_secret_value(), settings.ai_service_token.get_secret_value()]:
        assert_error(client.get("/api/v1/customers/CUST001/context", headers={"Authorization": "Bearer " + token}), 401, "UNAUTHORIZED")
    assert_error(client.get("/api/v1/customers/CUST999/context", headers=reviewer_headers), 404, "NOT_FOUND")
    context = client.get("/api/v1/customers/CUST001/context", headers=reviewer_headers)
    assert context.status_code == 200
    validate_contract("Context", context.json())
    assert_error(client.post("/api/v1/drafts", json=REQUEST, headers=reviewer_headers), 503, "SERVICE_UNAVAILABLE")


def test_expired_reviewer(settings):
    settings.reviewers[0].expires_at = "2020-01-01T00:00:00Z"
    from fastapi.testclient import TestClient
    with TestClient(create_app(settings)) as client:
        assert_error(client.get("/api/v1/drafts/DRAFT001", headers={"Authorization": "Bearer " + settings.reviewers[0].token.get_secret_value()}), 401, "UNAUTHORIZED")


@pytest.mark.parametrize("body", [dict(REQUEST, send=True), dict(REQUEST, channel="sms"), {"customer_id": "CUST001"}, dict(REQUEST, customer_id=123)])
def test_invalid_draft_requests(client, reviewer_headers, body):
    assert_error(client.post("/api/v1/drafts", json=body, headers=reviewer_headers), 422, "INVALID_REQUEST")


def test_missing_idempotency_and_invalid_request_ids(client, reviewer_headers):
    headers = dict(reviewer_headers)
    del headers["Idempotency-Key"]
    assert_error(client.post("/api/v1/drafts", json=REQUEST, headers=headers), 422, "INVALID_REQUEST")
    assert_error(client.get("/health", headers={"X-Request-ID": "bad id"}), 422, "INVALID_REQUEST")


def test_malformed_bodies_do_not_leak_inputs(client, reviewer_headers):
    headers = dict(reviewer_headers, **{"Content-Type": "application/json"})
    for body in [b'{"secret":"do-not-echo",', b'\xff', b'\xff\xfe{\x00}\x00']:
        response = client.post("/api/v1/drafts", content=body, headers=headers)
        assert_error(response, 422, "INVALID_REQUEST")
        assert "do-not-echo" not in response.text
    assert_error(client.post("/api/v1/drafts", content="{}", headers=reviewer_headers), 422, "INVALID_REQUEST")
    assert_error(client.post("/api/v1/drafts", content=b" " * (64 * 1024 + 1), headers=headers), 422, "INVALID_REQUEST")


def test_cors_and_query_restrictions(client):
    allowed = "http://100.117.73.55:5173"
    response = client.options("/api/v1/drafts", headers={"Origin": allowed, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,idempotency-key,x-request-id"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == allowed
    response = client.get("/api/v1/drafts/DRAFT001", headers={"Origin": allowed})
    assert_error(response, 401, "UNAUTHORIZED")
    assert response.headers["access-control-allow-origin"] == allowed
    assert_error(client.get("/health", headers={"Origin": "http://evil.example"}), 403, "FORBIDDEN")
    assert_error(client.options("/api/v1/drafts", headers={"Origin": allowed, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-delegation-token"}), 403, "FORBIDDEN")
    assert_error(client.get("/health?extra=true"), 422, "INVALID_REQUEST")
    assert_error(client.get("/missing"), 404, "NOT_FOUND")
    assert_error(client.delete("/health"), 422, "INVALID_REQUEST")


@pytest.mark.parametrize("decision,message,delivery", [("edit", None, "draft_only"), ("edit", {"subject": "a", "body": "b"}, "mock_email"), ("approve", {"subject": "a", "body": "b"}, "draft_only"), ("reject", None, "mock_email")])
def test_review_combinations_fail_before_business_logic(client, reviewer_headers, decision, message, delivery):
    body = {"expected_revision": 1, "decision": decision, "edited_message": message, "feedback": None, "delivery": delivery}
    assert_error(client.post("/api/v1/drafts/DRAFT001/review", json=body, headers=reviewer_headers), 422, "INVALID_REQUEST")


def test_valid_review_still_cannot_send(client, reviewer_headers):
    body = {"expected_revision": 1, "decision": "approve", "edited_message": None, "feedback": None, "delivery": "mock_email"}
    assert_error(client.post("/api/v1/drafts/DRAFT001/review", json=body, headers=reviewer_headers), 503, "SERVICE_UNAVAILABLE")


def delegation(settings, **overrides):
    now = int(time.time())
    claims = {"customer_id": "CUST001", "turn_id": "TURN001", "data_version": "data_v1", "policy_version": "policy_v1", "template_version": "templates_v1", "audience": "codevortex-ai-turn", "issued_at": now, "expires_at": now + 60}
    claims.update(overrides)
    return issue_delegation(settings, DelegationClaims.model_validate(claims))


def test_tools_service_auth_and_scope(client, settings, reviewer_headers):
    body = {"tool": "evaluate_customer", "turn_id": "TURN001", "arguments": {"customer_id": "CUST001"}}
    assert_error(client.post("/internal/v1/tools/execute", json=body, headers=reviewer_headers), 401, "UNAUTHORIZED")
    headers = {"Authorization": "Bearer " + settings.backend_tool_token.get_secret_value()}
    assert_error(client.post("/internal/v1/tools/execute", json=body, headers=headers), 403, "FORBIDDEN")
    headers["X-Delegation-Token"] = delegation(settings)
    assert_error(client.post("/internal/v1/tools/execute", json=body, headers=headers), 503, "SERVICE_UNAVAILABLE")
    assert_error(client.post("/internal/v1/tools/execute", json=dict(body, turn_id="TURN999"), headers=headers), 403, "FORBIDDEN")
    assert_error(client.post("/internal/v1/tools/execute", json=dict(body, tool="send_email"), headers=headers), 422, "INVALID_REQUEST")
    for token in ["invalid", delegation(settings) + "changed", delegation(settings, issued_at=int(time.time()) - 120, expires_at=int(time.time()) - 60), delegation(settings, expires_at=int(time.time()) + 120)]:
        headers["X-Delegation-Token"] = token
        assert_error(client.post("/internal/v1/tools/execute", json=body, headers=headers), 403, "FORBIDDEN")


def test_registry_and_embedded_examples_match_models():
    source = ROOT / "contracts/AI_SERVICE_CONTRACT.md"
    blocks = [json.loads(b) for b in re.findall(r'```json\n(.*?)\n```', source.read_text(), re.S)]
    assert next(b for b in blocks if "$defs" in b) == REGISTRY
    Draft202012Validator.check_schema(REGISTRY)
    for body in blocks:
        if "$defs" in body:
            continue
        matching = []
        for name in REGISTRY["$defs"]:
            try:
                validate_contract(name, body)
            except Exception:
                continue
            matching.append(name)
            model = getattr(models, name)
            assert model.model_validate(body).model_dump(mode="json") == body
        assert matching, body


def test_strict_money_and_calendar_validation():
    for bad in [True, -1, 12.5, "100"]:
        with pytest.raises(ValidationError):
            models.Money.model_validate({"amount_minor": bad, "currency": "INR"})
    valid = {"email_allowed": True, "marketing_opt_in": True, "service_email_allowed": True, "recorded_at": "2026-10-31T06:00:00Z", "source": "synthetic_seed"}
    for date in ["2026-02-30T06:00:00Z", "2026-10-31T06:00:00+00:00", "2026-10-31"]:
        with pytest.raises(ValidationError):
            models.Consent.model_validate(dict(valid, recorded_at=date))


def test_unexpected_errors_are_redacted(settings):
    from fastapi.testclient import TestClient
    app = create_app(settings)

    @app.get("/test-failure")
    async def fail():
        raise RuntimeError("private-secret-do-not-echo")

    with TestClient(app) as client:
        response = client.get("/test-failure")
        assert_error(response, 500, "INTERNAL_ERROR")
        assert "private-secret" not in response.text


def test_settings_reject_unsafe_configuration(settings, monkeypatch):
    from app.config import Settings, load_settings
    for key, value in [("delivery_mode", "smtp"), ("cors_origins", ["*"]), ("ai_service_token", "short")]:
        raw = settings.model_dump()
        raw[key] = value
        with pytest.raises(ValidationError):
            Settings.model_validate(raw)
    monkeypatch.setenv("AI_SERVICE_TOKEN", "private-short-token")
    with pytest.raises(RuntimeError) as exc:
        load_settings()
    assert "private-short-token" not in str(exc.value)
