"""HttpToolClient against a fake transport. Payloads come only from the contract's own examples."""

import asyncio
import json

import httpx
import pytest

from app.contract.models import Message, Plan
from app.http.errors import ApiError
from app.tools.client import HttpToolClient, ToolTimeout
from tests.conftest import load_example

BASE = "http://backend.test:8000"
TOOL_TOKEN = "tool-secret"
DELEGATION = "delegation.opaque.token"


def contract_plan() -> dict:
    """The Plan fields exactly as they appear in the contract's Draft example."""
    draft = load_example("Draft")
    return {
        "segments": draft["segments"],
        "strategy": draft["strategy"],
        "selected_offer_id": draft["selected_offer_id"],
        "eligibility": [],
        "validation": draft["validation"],
        "campaign_key": draft["campaign_key"],
    }


def contract_message() -> Message:
    return Message.model_validate(load_example("ValidateToolRequest")["arguments"]["message"])


def run(coro):
    return asyncio.run(coro)


def make_client(handler, timeout_s: float = 3.0) -> tuple[HttpToolClient, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    http = httpx.AsyncClient(transport=httpx.MockTransport(record))
    client = HttpToolClient(
        http=http,
        base_url=BASE + "/",
        tool_token=TOOL_TOKEN,
        delegation_token=DELEGATION,
        request_id="REQ001",
        timeout_s=timeout_s,
    )
    return client, seen


def echo_tool(result_for):
    """Answer each call with the given result for its tool, echoing tool and turn_id."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        return httpx.Response(200, json={"tool": body["tool"], "turn_id": body["turn_id"], "result": result_for[body["tool"]]})

    return handler


RESULTS = {"evaluate_customer": contract_plan(), "validate_draft": load_example("Draft")["validation"]}


def test_evaluate_sends_contract_request(validator_for):
    client, seen = make_client(echo_tool(RESULTS))
    plan = run(client.evaluate_customer(turn_id="TURN001", customer_id="CUST001"))

    assert isinstance(plan, Plan) and plan.strategy.template_id == "reward_v1"
    (req,) = seen
    assert req.method == "POST" and str(req.url) == BASE + "/internal/v1/tools/execute"
    assert req.headers["authorization"] == f"Bearer {TOOL_TOKEN}"
    assert req.headers["x-delegation-token"] == DELEGATION
    assert req.headers["x-request-id"] == "REQ001"
    body = json.loads(req.content)
    assert body == load_example("EvaluateToolRequest")
    validator_for("ToolRequest").validate(body)


def test_validate_sends_contract_request(validator_for):
    client, seen = make_client(echo_tool(RESULTS))
    validation = run(
        client.validate_draft(
            turn_id="TURN001",
            customer_id="CUST001",
            message=contract_message(),
            selected_offer_id="OFFER100",
            template_id="reward_v1",
        )
    )
    assert validation.passed is True
    body = json.loads(seen[0].content)
    assert body == load_example("ValidateToolRequest")
    validator_for("ToolRequest").validate(body)


def test_credentials_never_in_body():
    client, seen = make_client(echo_tool(RESULTS))
    run(client.evaluate_customer(turn_id="TURN001", customer_id="CUST001"))
    assert TOOL_TOKEN.encode() not in seen[0].content
    assert DELEGATION.encode() not in seen[0].content


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: {**b, "turn_id": "TURN999"},
        lambda b: {**b, "tool": "validate_draft", "result": RESULTS["validate_draft"]},
        lambda b: {**b, "extra": 1},
        lambda b: {**b, "result": {**b["result"], "campaign_key": "bad key!"}},
    ],
    ids=["other turn", "other tool", "unknown field", "schema violation"],
)
def test_untrustworthy_responses_are_503(mutate):
    def handler(request):
        body = json.loads(request.content)
        good = {"tool": body["tool"], "turn_id": body["turn_id"], "result": RESULTS[body["tool"]]}
        return httpx.Response(200, json=mutate(good))

    client, _ = make_client(handler)
    with pytest.raises(ApiError) as exc:
        run(client.evaluate_customer(turn_id="TURN001", customer_id="CUST001"))
    assert exc.value.code == "SERVICE_UNAVAILABLE"


def test_non_json_response_is_503():
    client, _ = make_client(lambda r: httpx.Response(200, text="<html>proxy</html>"))
    with pytest.raises(ApiError) as exc:
        run(client.evaluate_customer(turn_id="TURN001", customer_id="CUST001"))
    assert exc.value.code == "SERVICE_UNAVAILABLE"


@pytest.mark.parametrize(
    "status,code",
    [(401, "UNAUTHORIZED"), (403, "FORBIDDEN"), (404, "NOT_FOUND"), (422, "INVALID_REQUEST"), (503, "SERVICE_UNAVAILABLE")],
)
def test_backend_errors_keep_code_and_status_but_are_redacted(status, code):
    backend_error = load_example("Error")
    backend_error["error"]["code"] = code

    client, _ = make_client(lambda r: httpx.Response(status, json=backend_error))
    with pytest.raises(ApiError) as exc:
        run(client.evaluate_customer(turn_id="TURN001", customer_id="CUST001"))
    assert exc.value.code == code and exc.value.status_code == status
    assert backend_error["error"]["message"] not in exc.value.message
    assert exc.value.details == []


def test_rate_limit_keeps_retry_after():
    backend_error = load_example("Error")
    backend_error["error"].update(code="RATE_LIMITED", retryable=True)
    client, _ = make_client(lambda r: httpx.Response(429, json=backend_error, headers={"Retry-After": "3"}))
    with pytest.raises(ApiError) as exc:
        run(client.evaluate_customer(turn_id="TURN001", customer_id="CUST001"))
    assert exc.value.status_code == 429 and exc.value.retry_after == 3 and exc.value.retryable


def test_non_contract_error_body_is_503():
    client, _ = make_client(lambda r: httpx.Response(500, text="Internal Server Error"))
    with pytest.raises(ApiError) as exc:
        run(client.evaluate_customer(turn_id="TURN001", customer_id="CUST001"))
    assert exc.value.code == "SERVICE_UNAVAILABLE" and exc.value.retryable


def test_timeout_raises_tool_timeout():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    client, _ = make_client(handler)
    with pytest.raises(ToolTimeout):
        run(client.evaluate_customer(turn_id="TURN001", customer_id="CUST001"))


def test_unreachable_backend_is_retryable_503():
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    client, _ = make_client(handler)
    with pytest.raises(ApiError) as exc:
        run(client.evaluate_customer(turn_id="TURN001", customer_id="CUST001"))
    assert exc.value.code == "SERVICE_UNAVAILABLE" and exc.value.retryable


def test_timeout_value_is_passed_per_call():
    client, seen = make_client(echo_tool(RESULTS), timeout_s=3.0)
    run(client.evaluate_customer(turn_id="TURN001", customer_id="CUST001"))
    assert seen[0].extensions["timeout"]["read"] == 3.0
