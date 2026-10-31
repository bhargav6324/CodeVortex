import time
import json
from pathlib import Path
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.errors import ApiError
from app.storage.fixtures import instant


@pytest.fixture
def settings():
    expiry = datetime.fromtimestamp(time.time() + 3600, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return Settings.model_validate({
        "ai_service_base_url": "http://100.114.163.7:8001",
        "cors_origins": ["http://100.117.73.55:5173", "http://localhost:5173"],
        "backend_tool_token": "test-tool-" + "a" * 40,
        "ai_service_token": "test-ai-" + "b" * 40,
        "delegation_signing_secret": "test-signing-" + "c" * 40,
        "reviewers": [{"token": "test-reviewer-" + "d" * 40, "actor_id": "REVIEWER001", "role": "reviewer",
                       "customer_ids": ["CUST001"], "expires_at": expiry}],
        "delivery_mode": "mock_email",
    })


class OfflineAIClient:
    async def generate(self, request, delegation, request_id):
        raise ApiError(503, "SERVICE_UNAVAILABLE", "Offline AI adapter for the tester harness.", retryable=True)


@pytest.fixture
def client(settings):
    # Tester-owned suite must not contact the live AI service or depend on wall time.
    raw = json.loads((Path(__file__).resolve().parents[1] / "fixtures/dataset.json").read_text())
    reference = instant(raw["as_of"])
    with TestClient(create_app(settings, ai_client=OfflineAIClient(), clock=lambda: reference)) as value:
        yield value


@pytest.fixture
def reviewer_headers(settings):
    return {"Authorization": "Bearer " + settings.reviewers[0].token.get_secret_value(),
            "Idempotency-Key": "create_CUST001_001", "X-Request-ID": "REQ001"}
