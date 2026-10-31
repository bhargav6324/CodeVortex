"""HTTP behaviour shared by every response: Error envelope, headers, auth and request scope."""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings, get_settings
from tests.conftest import SERVICE_TOKEN

GENERATE = "/internal/v1/generate"


def assert_error(resp, status: int, code: str, validator_for) -> dict:
    assert resp.status_code == status, resp.text
    body = resp.json()
    validator_for("Error").validate(body)
    assert body["error"]["code"] == code
    assert body["error"]["request_id"] == resp.headers["x-request-id"]
    return body


def assert_contract_headers(resp) -> None:
    assert resp.headers["x-contract-version"] == "1.0.0"
    assert resp.headers["cache-control"] == "no-store"
    assert resp.headers["x-request-id"]


def test_missing_credentials_is_401(client, ai_request_body, validator_for):
    resp = client.post(GENERATE, json=ai_request_body)
    assert_error(resp, 401, "UNAUTHORIZED", validator_for)
    assert_contract_headers(resp)


def test_missing_delegation_token_is_401(client, ai_request_body, validator_for):
    resp = client.post(GENERATE, json=ai_request_body, headers={"Authorization": f"Bearer {SERVICE_TOKEN}"})
    assert_error(resp, 401, "UNAUTHORIZED", validator_for)


def test_wrong_service_token_is_401(client, ai_request_body, auth_headers, validator_for):
    headers = {**auth_headers, "Authorization": "Bearer not-the-token"}
    assert_error(client.post(GENERATE, json=ai_request_body, headers=headers), 401, "UNAUTHORIZED", validator_for)


def test_malformed_auth_header_is_422(client, ai_request_body, auth_headers, validator_for):
    headers = {**auth_headers, "Authorization": "Basic abc"}
    assert_error(client.post(GENERATE, json=ai_request_body, headers=headers), 422, "INVALID_REQUEST", validator_for)


def test_auth_is_checked_before_body(client, validator_for):
    assert_error(client.post(GENERATE, json={"junk": 1}), 401, "UNAUTHORIZED", validator_for)


def test_schema_violation_is_422_with_details(client, ai_request_body, auth_headers, validator_for):
    ai_request_body["context"]["customer"]["loyalty_points"] = "lots"
    body = assert_error(client.post(GENERATE, json=ai_request_body, headers=auth_headers), 422, "INVALID_REQUEST", validator_for)
    assert any(d["field"] == "context.customer.loyalty_points" for d in body["error"]["details"])


def test_malformed_json_is_422(client, auth_headers, validator_for):
    resp = client.post(GENERATE, content=b"{not json", headers={**auth_headers, "Content-Type": "application/json"})
    assert_error(resp, 422, "INVALID_REQUEST", validator_for)


@pytest.mark.parametrize(
    "field,value",
    [("customer_id", "CUST999"), ("as_of", "2026-10-31T06:00:01Z")],
)
def test_mismatched_scope_is_403(client, ai_request_body, auth_headers, validator_for, field, value):
    ai_request_body[field] = value
    assert_error(client.post(GENERATE, json=ai_request_body, headers=auth_headers), 403, "FORBIDDEN", validator_for)


def test_unconfigured_tool_credential_is_503(client, ai_request_body, auth_headers, validator_for):
    resp = client.post(GENERATE, json=ai_request_body, headers=auth_headers)
    assert_error(resp, 503, "SERVICE_UNAVAILABLE", validator_for)
    assert_contract_headers(resp)


def test_oversized_body_is_422(client, auth_headers, validator_for):
    resp = client.post(
        GENERATE, content=b"{" + b" " * (256 * 1024) + b"}", headers={**auth_headers, "Content-Type": "application/json"}
    )
    assert_error(resp, 422, "INVALID_REQUEST", validator_for)
    assert_contract_headers(resp)


def test_oversized_chunked_body_is_422(client, auth_headers, validator_for):
    def chunks():
        for _ in range(5):
            yield b" " * (64 * 1024)

    resp = client.post(GENERATE, content=chunks(), headers={**auth_headers, "Content-Type": "application/json"})
    assert_error(resp, 422, "INVALID_REQUEST", validator_for)


def test_request_id_is_echoed(client, ai_request_body, auth_headers):
    resp = client.post(GENERATE, json=ai_request_body, headers={**auth_headers, "X-Request-ID": "REQ001"})
    assert resp.headers["x-request-id"] == "REQ001"
    assert resp.json()["error"]["request_id"] == "REQ001"


def test_request_id_generated_when_absent(client, ai_request_body, auth_headers):
    rid = client.post(GENERATE, json=ai_request_body, headers=auth_headers).headers["x-request-id"]
    assert rid.startswith("REQ_")


def test_bad_request_id_is_422(client, ai_request_body, auth_headers, validator_for):
    resp = client.post(GENERATE, json=ai_request_body, headers={**auth_headers, "X-Request-ID": "bad id!"})
    body = assert_error(resp, 422, "INVALID_REQUEST", validator_for)
    assert body["error"]["details"][0]["field"] == "X-Request-ID"
    assert resp.headers["x-request-id"] != "bad id!"


@pytest.mark.parametrize("method,path", [("GET", "/nope"), ("GET", GENERATE), ("GET", "/health")])
def test_unknown_route_or_method_is_404(client, validator_for, method, path):
    resp = client.request(method, path)
    assert_error(resp, 404, "NOT_FOUND", validator_for)
    assert_contract_headers(resp)


def test_unhandled_exception_is_redacted_500(validator_for):
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(ai_service_token=SERVICE_TOKEN, _env_file=None)

    @app.get("/boom")
    async def boom():
        raise RuntimeError("secret detail")

    resp = TestClient(app, raise_server_exceptions=False).get("/boom")
    body = assert_error(resp, 500, "INTERNAL_ERROR", validator_for)
    assert "secret" not in resp.text
    assert body["error"]["details"] == []
    assert_contract_headers(resp)
