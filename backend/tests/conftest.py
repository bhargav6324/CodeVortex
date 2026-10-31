import time
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


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


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as value:
        yield value


@pytest.fixture
def reviewer_headers(settings):
    return {"Authorization": "Bearer " + settings.reviewers[0].token.get_secret_value(),
            "Idempotency-Key": "create_CUST001_001", "X-Request-ID": "REQ001"}
