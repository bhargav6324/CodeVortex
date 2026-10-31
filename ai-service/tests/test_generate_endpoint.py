"""POST /internal/v1/generate over HTTP, with the backend tools and Gemini replaced by test doubles."""

import pytest
from fastapi.testclient import TestClient

from app.api.generate import get_gemini, get_tool_client_factory
from app.main import create_app
from app.settings import Settings, get_settings
from tests.conftest import SERVICE_TOKEN
from tests.test_orchestrator import MODEL, FakeGemini, FakeTools, blocked, canonical, contract_plan, reply_json

GENERATE = "/internal/v1/generate"


def make_client(tools, gemini, **settings):
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(ai_service_token=SERVICE_TOKEN, _env_file=None, **settings)
    app.dependency_overrides[get_tool_client_factory] = lambda: (lambda caller: tools)
    app.dependency_overrides[get_gemini] = lambda: (gemini, MODEL if gemini else None)
    return TestClient(app)


@pytest.fixture
def post(ai_request_body, auth_headers):
    def go(client):
        with client:
            return client.post(GENERATE, json=ai_request_body, headers={**auth_headers, "X-Request-ID": "REQ001"})

    return go


def test_generated_over_http(post, validator_for):
    tools = FakeTools(contract_plan())
    resp = post(make_client(tools, FakeGemini(reply_json(canonical()))))

    assert resp.status_code == 200, resp.text
    body = resp.json()
    validator_for("AIResponse").validate(body)
    assert body["generation_status"] == "generated"
    assert body["message"] == canonical().model_dump()
    assert resp.headers["x-request-id"] == "REQ001" and resp.headers["x-contract-version"] == "1.0.0"
    # No credentials or prompt text in the response.
    assert "Bearer" not in resp.text and "DATA:" not in resp.text and "untrusted" not in resp.text


def test_blocked_over_http_is_200(post, validator_for):
    plan = contract_plan(strategy=None, selected_offer_id=None,
                         validation=blocked("CONSENT_REQUIRED", "consent.marketing_opt_in").model_dump(mode="json"))
    resp = post(make_client(FakeTools(plan), FakeGemini()))
    assert resp.status_code == 200
    validator_for("AIResponse").validate(resp.json())
    assert resp.json()["generation_status"] == "blocked" and resp.json()["model_version"] == "not_invoked"


def test_unavailable_over_http_is_200(post, validator_for):
    resp = post(make_client(FakeTools(contract_plan()), FakeGemini("x", "y")))
    assert resp.status_code == 200
    validator_for("AIResponse").validate(resp.json())
    assert resp.json()["generation_status"] == "unavailable" and resp.json()["message"] is None


def test_timeout_over_http_is_504_error(post, validator_for):
    resp = post(make_client(FakeTools(contract_plan(), delay=0.3), FakeGemini(), workflow_budget_s=0.1))
    assert resp.status_code == 504
    validator_for("Error").validate(resp.json())
    assert resp.json()["error"]["code"] == "AI_TIMEOUT" and resp.json()["error"]["retryable"] is True
    assert resp.json()["error"]["request_id"] == "REQ001"


def test_scope_is_checked_before_any_tool_call(ai_request_body, auth_headers):
    tools = FakeTools(contract_plan())
    ai_request_body["customer_id"] = "CUST999"
    with make_client(tools, FakeGemini()) as client:
        resp = client.post(GENERATE, json=ai_request_body, headers=auth_headers)
    assert resp.status_code == 403 and tools.calls == []


def test_unauthenticated_request_never_reaches_tools(ai_request_body):
    tools = FakeTools(contract_plan())
    with make_client(tools, FakeGemini()) as client:
        resp = client.post(GENERATE, json=ai_request_body)
    assert resp.status_code == 401 and tools.calls == []
