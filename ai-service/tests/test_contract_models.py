"""The Pydantic models must accept and reject exactly what the frozen JSON Schema registry does."""

import copy

import pytest
from pydantic import BaseModel, ValidationError

from app.contract import models as m
from tests.conftest import load_example

# Registry definition -> model. Health is backend-only and not served here.
TOP_LEVEL = {
    "Money": m.Money,
    "Message": m.Message,
    "Evidence": m.Evidence,
    "Segment": m.Segment,
    "Strategy": m.Strategy,
    "Finding": m.Finding,
    "Validation": m.Validation,
    "Offer": m.Offer,
    "Customer": m.Customer,
    "Consent": m.Consent,
    "Billing": m.Billing,
    "Contact": m.Contact,
    "Context": m.Context,
    "Policy": m.Policy,
    "Eligibility": m.Eligibility,
    "Plan": m.Plan,
    "Versions": m.Versions,
    "DraftRequest": m.DraftRequest,
    "Draft": m.Draft,
    "ReviewRequest": m.ReviewRequest,
    "AIRequest": m.AIRequest,
    "AIResponse": m.AIResponse,
    "EvaluateToolRequest": m.EvaluateToolRequest,
    "ValidateToolRequest": m.ValidateToolRequest,
    "EvaluateToolResponse": m.EvaluateToolResponse,
    "ValidateToolResponse": m.ValidateToolResponse,
    "Error": m.Error,
    "Dataset": m.Dataset,
}

# Inline (anonymous) objects inside the registry -> model.
NESTED = [
    (("Policy", "templates", "items"), m.Template),
    (("Dataset", "labels", "items"), m.DatasetLabel),
    (("Error", "error"), m.ErrorBody),
    (("Error", "error", "details", "items"), m.ErrorDetail),
    (("EvaluateToolRequest", "arguments"), m.EvaluateArguments),
    (("ValidateToolRequest", "arguments"), m.ValidateArguments),
]


def _node(schema: dict, path: tuple[str, ...]) -> dict:
    node = schema["$defs"][path[0]]
    for key in path[1:]:
        node = node["items"] if key == "items" else node["properties"][key]
    return node


def _assert_same_shape(node: dict, model: type[BaseModel]) -> None:
    assert node["type"] == "object"
    assert node["additionalProperties"] is False
    assert set(node["properties"]) == set(model.model_fields)
    assert set(node["required"]) == set(model.model_fields)
    assert model.model_config.get("extra") == "forbid"
    assert all(f.is_required() for f in model.model_fields.values())


def test_registry_is_fully_covered(schema):
    defs = set(schema["$defs"])
    assert len(defs) == 31
    assert defs - set(TOP_LEVEL) == {"Health", "ToolRequest", "ToolResponse"}


@pytest.mark.parametrize("name", sorted(TOP_LEVEL))
def test_top_level_shapes_match(schema, name):
    _assert_same_shape(schema["$defs"][name], TOP_LEVEL[name])


@pytest.mark.parametrize("path,model", NESTED, ids=lambda p: ".".join(p) if isinstance(p, tuple) else p.__name__)
def test_nested_shapes_match(schema, path, model):
    _assert_same_shape(_node(schema, path), model)


@pytest.mark.parametrize(
    "name", ["EvaluateToolRequest", "ValidateToolRequest", "DraftRequest", "Draft", "ReviewRequest", "Error", "Dataset"]
)
def test_contract_examples_valid_in_both(validator_for, name):
    example = load_example(name)
    validator_for(name).validate(example)
    parsed = TOP_LEVEL[name].model_validate(example)
    # Serialised output must still satisfy the schema (UTC timestamps as Z, ints stay ints).
    validator_for(name).validate(parsed.model_dump(mode="json"))


def test_tool_unions_dispatch_on_tool_name():
    from pydantic import TypeAdapter

    adapter = TypeAdapter(m.ToolRequest)
    assert isinstance(adapter.validate_python(load_example("EvaluateToolRequest")), m.EvaluateToolRequest)
    assert isinstance(adapter.validate_python(load_example("ValidateToolRequest")), m.ValidateToolRequest)
    with pytest.raises(ValidationError):
        adapter.validate_python({**load_example("EvaluateToolRequest"), "tool": "run_sql"})


def test_ai_request_from_seed_is_valid(validator_for, ai_request_body):
    validator_for("AIRequest").validate(ai_request_body)
    req = m.AIRequest.model_validate(ai_request_body)
    validator_for("AIRequest").validate(req.model_dump(mode="json"))


def test_serialised_timestamps_use_z(ai_request_body):
    dumped = m.AIRequest.model_validate(ai_request_body).model_dump(mode="json")
    assert dumped["as_of"] == "2026-10-31T06:00:00Z"
    assert dumped["context"]["billing"]["due_date"] == "2026-10-15"


def _mutate(body: dict, path: list, value=None, delete=False) -> dict:
    body = copy.deepcopy(body)
    target = body
    for key in path[:-1]:
        target = target[key]
    if delete:
        del target[path[-1]]
    else:
        target[path[-1]] = value
    return body


INVALID_CASES = {
    "unknown top-level field": (["debug"], True, False),
    "unknown nested field": (["context", "customer", "email"], "a@b.c", False),
    "missing required field": (["locale"], None, True),
    "missing nullable field (null must be explicit)": (["context", "customer", "last_activity_at"], None, True),
    "string for integer": (["context", "customer", "loyalty_points"], "1200", False),
    "bool for integer": (["context", "customer", "tenure_months"], True, False),
    "negative money": (["context", "billing", "amount_due", "amount_minor"], -1, False),
    "non-INR currency": (["context", "billing", "amount_due", "currency"], "USD", False),
    "bad enum": (["context", "billing", "status"], "late", False),
    "bad id pattern": (["turn_id"], "TURN 001", False),
    "unix timestamp instead of string": (["as_of"], 1793426400, False),
    "non-UTC offset": (["as_of"], "2026-10-31T11:30:00+05:30", False),
    "timely payments above 3": (["context", "customer", "timely_payments_last_3"], 4, False),
    "string for bool": (["context", "consent", "email_allowed"], "true", False),
}


@pytest.mark.parametrize("case", sorted(INVALID_CASES))
def test_invalid_requests_rejected(ai_request_body, validator_for, case):
    path, value, delete = INVALID_CASES[case]
    body = _mutate(ai_request_body, path, value, delete)
    with pytest.raises(ValidationError):
        m.AIRequest.model_validate(body)
    # Non-UTC offsets are valid RFC3339 for the schema but rejected by the contract's "UTC Z" rule.
    if case != "non-UTC offset":
        assert not validator_for("AIRequest").is_valid(body)


def test_nullable_fields_accept_explicit_null(ai_request_body):
    body = _mutate(ai_request_body, ["context", "customer", "last_activity_at"], None)
    body = _mutate(body, ["context", "customer", "timely_payments_last_3"], None)
    req = m.AIRequest.model_validate(body)
    assert req.context.customer.last_activity_at is None
    assert req.context.customer.timely_payments_last_3 is None


def test_evidence_values_keep_their_json_type():
    for value in [1200, 0.5, True, "overdue", None]:
        dumped = m.Evidence(field="x", value=value).model_dump(mode="json")["value"]
        assert dumped == value and type(dumped) is type(value)
