import json
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.errors import ApiError
from app.main import create_app
from app.ratelimit import RateLimiter
from app.storage.fixtures import instant
from app.storage.sqlite import SQLiteStorage
from test_phase1 import assert_error
from test_phase3 import ACTIVE
from test_sqlite_review import Env

ROOT = Path(__file__).resolve().parents[1]


class Ticker:
    def __init__(self):
        self.value = 1000.0

    def __call__(self):
        return self.value


def test_sliding_window_limit():
    ticker = Ticker()
    limiter = RateLimiter({"generate": 3}, clock=ticker)
    for _ in range(3):
        limiter.check("A", "generate")
    with pytest.raises(ApiError) as exc:
        limiter.check("A", "generate")
    assert exc.value.status == 429 and exc.value.code == "RATE_LIMITED" and exc.value.retry_after == 60
    limiter.check("B", "generate")
    ticker.value += 30
    with pytest.raises(ApiError) as exc:
        limiter.check("A", "generate")
    assert exc.value.retry_after == 30
    ticker.value += 30
    limiter.check("A", "generate")


def test_settings_defaults_and_bounds(settings):
    assert settings.rate_limit_generate_per_minute == 20 and settings.rate_limit_read_review_per_minute == 60
    raw = settings.model_dump()
    raw["rate_limit_generate_per_minute"] = 0
    raw.update({k: v.get_secret_value() for k, v in settings.model_dump().items() if hasattr(v, "get_secret_value")})
    raw["reviewers"] = [dict(r.model_dump(), token=r.token.get_secret_value()) for r in settings.reviewers]
    with pytest.raises(ValidationError):
        Settings.model_validate(raw)


def limited_client(settings, generate, read_review):
    tuned = settings.model_copy(update={"rate_limit_generate_per_minute": generate, "rate_limit_read_review_per_minute": read_review})
    return TestClient(create_app(tuned))


def test_http_generation_limit(settings, reviewer_headers):
    body = {"customer_id": "CUST001", "channel": "email", "locale": "en-IN"}
    with limited_client(settings, 2, 60) as client:
        for index in range(2):
            response = client.post("/api/v1/drafts", json=body, headers=dict(reviewer_headers, **{"Idempotency-Key": "k%d" % index}))
            assert response.status_code != 429
        response = client.post("/api/v1/drafts", json=body, headers=dict(reviewer_headers, **{"Idempotency-Key": "k9"}))
        assert_error(response, 429, "RATE_LIMITED")
        assert response.json()["error"]["retryable"] is True
        assert 1 <= int(response.headers["retry-after"]) <= 60
        assert client.get("/api/v1/customers/CUST001/context", headers=reviewer_headers).status_code == 200


def test_http_read_limit_and_unauthenticated_not_counted(settings, reviewer_headers):
    with limited_client(settings, 20, 2) as client:
        for _ in range(5):
            assert client.get("/api/v1/customers/CUST001/context").status_code == 401
        for _ in range(2):
            assert client.get("/api/v1/customers/CUST001/context", headers=reviewer_headers).status_code == 200
        assert_error(client.get("/api/v1/drafts/DRAFT001", headers=reviewer_headers), 429, "RATE_LIMITED")
        assert client.get("/health").status_code == 200


def test_cors_exposes_retry_after_on_429(settings, reviewer_headers):
    origin = "http://100.117.73.55:5173"
    with limited_client(settings, 20, 1) as client:
        client.get("/api/v1/customers/CUST001/context", headers=reviewer_headers)
        response = client.get("/api/v1/customers/CUST001/context", headers=dict(reviewer_headers, Origin=origin))
        assert response.status_code == 429
        assert response.headers["access-control-allow-origin"] == origin
        assert "Retry-After" in response.headers["access-control-expose-headers"]


# ---------- retention cleanup ----------

needs_active = pytest.mark.skipif(not ACTIVE.exists(), reason="local 50-customer dataset is not present")


@pytest.fixture
def env(tmp_path, monkeypatch):
    if not ACTIVE.exists():
        pytest.skip("local 50-customer dataset is not present")
    from test_phase3 import Clock
    clock = Clock(instant(json.loads(ACTIVE.read_text())["as_of"]))
    value = Env(tmp_path / "retention.sqlite3", clock, monkeypatch)
    yield value
    value.close()


def test_purge_removes_only_expired_records(env):
    old = env.draft("C004", "old")
    assert env.review(old, "approve", "send_old", delivery="mock_email").status_code == 200
    contacts_before = len(json.loads(env.rows("SELECT payload_json FROM contexts WHERE customer_id='C004'")[0][0])["contacts"])
    env.clock.value += timedelta(days=2)
    env.settings.reviewers[0].expires_at = "2030-01-01T00:00:00Z"
    recent = env.draft("C001", "recent")
    storage = SQLiteStorage(env.db, clock=env.clock)

    env.clock.value += timedelta(days=6)
    counts = storage.purge_expired(7, 7, dry_run=True)
    assert counts["drafts"] == 1 and counts["outbox"] == 1 and counts["reviews"] == 1 and counts["audit"] == 3
    assert counts["idempotency"] == 3
    assert env.rows("SELECT COUNT(*) FROM drafts") == [(2,)]

    counts = storage.purge_expired(7, 7)
    assert counts["drafts"] == 1
    assert [row[0] for row in env.rows("SELECT draft_id FROM drafts")] == [recent["draft_id"]]
    assert env.rows("SELECT COUNT(*) FROM outbox") == [(0,)] and env.rows("SELECT COUNT(*) FROM reviews") == [(0,)]
    assert env.rows("SELECT COUNT(*) FROM audit") == [(1,)] and env.rows("SELECT COUNT(*) FROM idempotency") == [(0,)]
    contacts_after = len(json.loads(env.rows("SELECT payload_json FROM contexts WHERE customer_id='C004'")[0][0])["contacts"])
    assert contacts_after == contacts_before
    assert storage.purge_expired(7, 7)["drafts"] == 0


def test_purge_never_cuts_inside_dedupe_window(env):
    draft = env.draft("C001")
    env.clock.value += timedelta(days=8)
    storage = SQLiteStorage(env.db, clock=env.clock)
    assert storage.purge_expired(7, 10)["drafts"] == 0
    env.clock.value += timedelta(days=3)
    assert storage.purge_expired(7, 10)["drafts"] == 1
    assert env.rows("SELECT COUNT(*) FROM drafts WHERE draft_id=?", draft["draft_id"]) == [(0,)]


def test_cleanup_script(env):
    env.draft("C001")
    script = str(ROOT / "scripts/cleanup_database.py")
    result = subprocess.run([sys.executable, script, "--database", str(env.db), "--retention-days", "7", "--dry-run"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("Would delete:") and "drafts=0" in result.stdout
    refused = subprocess.run([sys.executable, script, "--database", str(env.db), "--retention-days", "3"], capture_output=True, text=True)
    assert refused.returncode != 0 and "at least 7" in refused.stderr
    missing = subprocess.run([sys.executable, script, "--database", str(env.db) + ".missing"], capture_output=True, text=True)
    assert missing.returncode != 0
    assert not Path(str(env.db) + ".missing").exists()
