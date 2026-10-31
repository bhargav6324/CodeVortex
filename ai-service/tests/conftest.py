import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from app.main import create_app
from app.settings import Settings, get_settings

CONTRACT_DIR = Path(__file__).resolve().parents[1] / "contract"
SERVICE_TOKEN = "test-service-token"


@pytest.fixture(scope="session")
def schema() -> dict:
    return json.loads((CONTRACT_DIR / "schema-1.0.0.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def validator_for(schema):
    """Return a JSON Schema validator for one named definition in the registry."""

    def make(name: str) -> Draft202012Validator:
        return Draft202012Validator({"$defs": schema["$defs"], "$ref": f"#/$defs/{name}"})

    return make


def load_example(name: str) -> dict:
    return json.loads((CONTRACT_DIR / "examples" / f"{name}.json").read_text(encoding="utf-8"))


@pytest.fixture
def ai_request_body() -> dict:
    """A valid AIRequest built from the contract's seed Dataset (CUST001)."""
    dataset = load_example("Dataset")
    context = dataset["customers"][0]
    return {
        "turn_id": "TURN001",
        "customer_id": context["customer"]["customer_id"],
        "as_of": context["as_of"],
        "context": context,
        "policy": dataset["policy"],
        "locale": "en-IN",
    }


@pytest.fixture
def client():
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(ai_service_token=SERVICE_TOKEN, _env_file=None)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers() -> dict:
    return {"Authorization": f"Bearer {SERVICE_TOKEN}", "X-Delegation-Token": "delegation.opaque.token"}
