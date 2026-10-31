import json
import sqlite3
import threading
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.clock import stamp
from app.config import Settings
from app.errors import ApiError
from app.main import create_app
from app.models import ReviewRequest
from app.services.policy import PolicyEngine
from app.services.review import ReviewService
from app.storage import repositories
from app.storage.fixtures import instant, load_fixtures
from app.storage.interfaces import StorageUnavailable
from app.storage.records import IdempotencyScope
from app.storage.sqlite import SQLiteStorage
from test_phase3 import ACTIVE, Clock, ScriptedAI, post_draft

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(not ACTIVE.exists(), reason="local 50-customer dataset is not present")
TOKEN = "test-reviewer-" + "d" * 40
LIMITED = "test-limited-" + "e" * 40


def make_settings(db, clock):
    return Settings.model_validate({
        "ai_service_base_url": "http://100.114.163.7:8001",
        "cors_origins": ["http://100.117.73.55:5173"],
        "backend_tool_token": "test-tool-" + "a" * 40,
        "ai_service_token": "test-ai-" + "b" * 40,
        "delegation_signing_secret": "test-signing-" + "c" * 40,
        "reviewers": [{"token": TOKEN, "actor_id": "REVIEWER001", "role": "reviewer",
                       "customer_ids": ["C%03d" % i for i in range(1, 51)], "expires_at": stamp(clock.value + timedelta(days=1))},
                      {"token": LIMITED, "actor_id": "REVIEWER002", "role": "reviewer",
                       "customer_ids": ["C002"], "expires_at": stamp(clock.value + timedelta(days=1))}],
        "delivery_mode": "mock_email",
        "storage_backend": "sqlite",
        "database_path": str(db),
        "dataset_path": str(ACTIVE),
        "draft_fixture_path": None,
    })


class Env:
    def __init__(self, db, clock, monkeypatch):
        self.db, self.clock = db, clock
        monkeypatch.setattr(auth, "time", type("T", (), {"time": staticmethod(lambda: clock.value.timestamp())}))
        self.settings = make_settings(db, clock)
        self.open()

    def open(self):
        self.ai = ScriptedAI(self.settings)
        self.app = create_app(self.settings, ai_client=self.ai, clock=self.clock)
        self.app.state.clock_ref = self.clock
        self.ai.app = self.app
        self.client = TestClient(self.app)
        self.client.__enter__()

    def close(self):
        self.client.__exit__(None, None, None)

    def reopen(self):
        self.close()
        self.open()

    def draft(self, customer, key=None):
        response = post_draft(self.client, self.settings, customer, key or "gen_" + customer)
        assert response.status_code in (200, 201), response.text
        return response.json()

    def review(self, draft, decision, key, delivery="draft_only", edited=None, revision=None, token=TOKEN, feedback=None):
        body = {"expected_revision": revision if revision is not None else draft["revision"], "decision": decision,
                "edited_message": edited, "feedback": feedback, "delivery": delivery}
        headers = {"Authorization": "Bearer " + token, "Idempotency-Key": key}
        return self.client.post("/api/v1/drafts/" + draft["draft_id"] + "/review", json=body, headers=headers)

    def get(self, draft_id):
        return self.client.get("/api/v1/drafts/" + draft_id, headers={"Authorization": "Bearer " + TOKEN}).json()

    def rows(self, sql, *args):
        connection = sqlite3.connect(str(self.db))
        try:
            return connection.execute(sql, args).fetchall()
        finally:
            connection.close()


@pytest.fixture
def env(tmp_path, monkeypatch):
    clock = Clock(instant(json.loads(ACTIVE.read_text())["as_of"]))
    value = Env(tmp_path / "test.sqlite3", clock, monkeypatch)
    yield value
    value.close()


def code(response):
    return response.json()["error"]["code"]


# ---------- persistence and seeding ----------

def test_seed_once_and_restart_persistence(env):
    assert env.rows("SELECT value FROM metadata WHERE key='seed_customer_count'") == [("50",)]
    assert env.rows("SELECT offer_id FROM offers ORDER BY offer_id") == [("OFFER100",), ("OFFER_EXP01",)]
    created = env.draft("C001", "persist")
    env.reopen()
    assert env.get(created["draft_id"]) == created
    replay = post_draft(env.client, env.settings, "C001", "persist")
    assert replay.status_code == 200 and replay.json() == created
    assert env.ai.calls == 0
    assert env.rows("SELECT COUNT(*) FROM audit") == [(1,)]
    assert env.rows("SELECT COUNT(*) FROM turns") == [(0,)]


def test_reopen_with_other_dataset_keeps_state(env):
    env.draft("C001")
    other, _ = load_fixtures(ROOT / "fixtures/dataset.json", None)
    storage = SQLiteStorage(env.db, clock=env.clock)
    assert storage.seeded() and storage.seed(other) is False
    customers = {row[0] for row in env.rows("SELECT customer_id FROM contexts")}
    assert "C001" in customers and "CUST001" not in customers


def test_foreign_and_old_files_are_refused_without_deletion(tmp_path):
    foreign = tmp_path / "foreign.sqlite3"
    connection = sqlite3.connect(str(foreign))
    connection.execute("CREATE TABLE notes(x TEXT)")
    connection.execute("INSERT INTO notes VALUES ('keep')")
    connection.commit()
    connection.close()
    with pytest.raises(StorageUnavailable):
        SQLiteStorage(foreign)
    assert sqlite3.connect(str(foreign)).execute("SELECT x FROM notes").fetchall() == [("keep",)]
    old = tmp_path / "old.sqlite3"
    SQLiteStorage(old)
    connection = sqlite3.connect(str(old))
    connection.execute("UPDATE metadata SET value='0' WHERE key='schema_version'")
    connection.commit()
    connection.close()
    with pytest.raises(StorageUnavailable):
        SQLiteStorage(old)


def test_constraints_enforced_by_database(env):
    draft = env.draft("C001")
    connection = sqlite3.connect(str(env.db))
    connection.execute("PRAGMA foreign_keys=ON")
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute("INSERT INTO audit(audit_id,draft_id,occurred_at,payload_json) VALUES('A','NO_SUCH_DRAFT','x','{}')")
    connection.execute("INSERT INTO outbox VALUES('D1',?, 'C001','c','h','t','{}')", (draft["draft_id"],))
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute("INSERT INTO outbox VALUES('D2',?, 'C001','c','h','t','{}')", (draft["draft_id"],))
    connection.rollback()
    connection.close()


def test_generation_failure_leaves_no_rows(env):
    env.ai.mode = "skip_validate"
    assert post_draft(env.client, env.settings, "C001", "fail").status_code == 503
    assert env.rows("SELECT COUNT(*) FROM drafts") == [(0,)]
    assert env.rows("SELECT COUNT(*) FROM turns") == [(0,)]
    assert env.rows("SELECT COUNT(*) FROM idempotency") == [(0,)]


# ---------- human review ----------

def test_approve_draft_only(env):
    draft = env.draft("C001")
    response = env.review(draft, "approve", "r1", feedback="Looks good")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] == "approved" and result["send_status"] == "draft_only" and result["revision"] == 2
    assert result["approved_by"] == "REVIEWER001" and result["delivery_id"] is None and result["feedback"] == "Looks good"
    assert result["message"] == draft["message"]
    assert env.rows("SELECT COUNT(*) FROM outbox") == [(0,)]
    context = json.loads(env.rows("SELECT payload_json FROM contexts WHERE customer_id='C001'")[0][0])
    assert context["contacts"] == []


def test_approve_mock_email_writes_one_ledger_row(env):
    draft = env.draft("C004")
    before = json.loads(env.rows("SELECT payload_json FROM contexts WHERE customer_id='C004'")[0][0])
    response = env.review(draft, "approve", "send1", delivery="mock_email")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] == "mock_sent" and result["send_status"] == "mock_sent" and result["delivery_id"]
    outbox = env.rows("SELECT delivery_id, draft_id, campaign_key FROM outbox")
    assert outbox == [(result["delivery_id"], draft["draft_id"], draft["campaign_key"])]
    after = json.loads(env.rows("SELECT payload_json FROM contexts WHERE customer_id='C004'")[0][0])
    assert len(after["contacts"]) == len(before["contacts"]) + 1 and after["data_version"] != before["data_version"]
    events = [json.loads(p)["event"] for p, in env.rows("SELECT payload_json FROM audit WHERE draft_id=? ORDER BY occurred_at, rowid", draft["draft_id"])]
    assert events == ["draft_created", "draft_approved", "mock_sent"]
    replay = env.review(draft, "approve", "send1", delivery="mock_email")
    assert replay.status_code == 200 and replay.json() == result
    assert env.rows("SELECT COUNT(*) FROM outbox") == [(1,)]
    assert code(env.review(draft, "approve", "send2", delivery="mock_email", revision=2)) == "INVALID_TRANSITION"


def test_reject_ready_and_blocked(env):
    ready = env.draft("C001")
    blocked = env.draft("C007")
    assert blocked["status"] == "blocked"
    for draft, key in ((ready, "rej1"), (blocked, "rej2")):
        response = env.review(draft, "reject", key, feedback="Regenerate")
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "rejected" and response.json()["revision"] == 2
    assert env.rows("SELECT COUNT(*) FROM outbox") == [(0,)]


def test_blocked_and_stale_and_terminal_rules(env):
    blocked = env.draft("C019")
    response = env.review(blocked, "approve", "b1")
    assert response.status_code == 422 and code(response) == "REVIEW_BLOCKED"
    ready = env.draft("C001")
    response = env.review(ready, "approve", "stale", revision=5)
    assert response.status_code == 409 and code(response) == "VERSION_CONFLICT"
    assert env.review(ready, "reject", "done").status_code == 200
    response = env.review(ready, "approve", "after", revision=2)
    assert response.status_code == 409 and code(response) == "INVALID_TRANSITION"
    assert env.rows("SELECT COUNT(*) FROM idempotency WHERE payload_json LIKE '%pending%'") == [(0,)]


def test_edit_rules(env):
    draft = env.draft("C001")
    formatted = {"subject": draft["message"]["subject"] + " ", "body": draft["message"]["body"].replace("\n", "\r\n")}
    response = env.review(draft, "edit", "e1", edited=formatted)
    assert response.status_code == 200, response.text
    edited = response.json()
    assert edited["status"] == "ready_for_review" and edited["revision"] == 2 and edited["approved_by"] is None
    current = edited
    for index, (body, expected) in enumerate([(draft["message"]["body"] + " Guaranteed savings!", "PROHIBITED_LANGUAGE"),
                                              (draft["message"]["body"] + " You won INR 5000!", "UNSUPPORTED_CLAIM"),
                                              (draft["message"]["body"].replace("Terms apply. This is a draft for human review.", ""), "POLICY_MISMATCH")]):
        response = env.review(current, "edit", "warn%d" % index, edited={"subject": draft["message"]["subject"], "body": body})
        assert response.status_code == 200, response.text
        current = response.json()
        assert current["status"] == "ready_for_review" and current["message"]["body"] == body
        assert expected in {f["code"] for f in current["validation"]["findings"] if f["severity"] == "warning"}
    approved = env.review(current, "approve", "e_ok")
    assert approved.status_code == 200 and approved.json()["revision"] == 6


def test_idempotency_key_reuse_with_new_body_conflicts(env):
    draft = env.draft("C001")
    assert env.review(draft, "reject", "same").status_code == 200
    response = env.review(draft, "reject", "same", feedback="different")
    assert response.status_code == 409 and code(response) == "IDEMPOTENCY_CONFLICT"


def test_delivery_invalidates_other_outstanding_drafts(env):
    first = env.draft("C001", "first")
    second = env.draft("C001", "second")
    assert env.review(first, "approve", "send", delivery="mock_email").status_code == 200
    response = env.review(second, "approve", "send_again", delivery="mock_email")
    assert response.status_code == 409 and code(response) == "VERSION_CONFLICT"
    assert env.rows("SELECT COUNT(*) FROM outbox") == [(1,)]


def test_current_consent_rechecked_at_approval(env):
    draft = env.draft("C001")
    connection = sqlite3.connect(str(env.db))
    payload = json.loads(connection.execute("SELECT payload_json FROM contexts WHERE customer_id='C001'").fetchone()[0])
    payload["consent"]["marketing_opt_in"] = False
    connection.execute("UPDATE contexts SET payload_json=? WHERE customer_id='C001'", (json.dumps(payload),))
    connection.commit()
    connection.close()
    response = env.review(draft, "approve", "consent", delivery="mock_email")
    assert response.status_code == 422 and code(response) == "REVIEW_BLOCKED"
    assert "CONSENT_REQUIRED" in response.text
    assert env.rows("SELECT COUNT(*) FROM outbox") == [(0,)]


def test_offer_expiry_rechecked_at_approval(env):
    draft = env.draft("C004")
    env.clock.value = instant("2026-11-30T23:59:59Z")
    env.settings.reviewers[0].expires_at = stamp(env.clock.value + timedelta(days=1))
    response = env.review(draft, "approve", "expired")
    assert response.status_code == 422 and code(response) == "REVIEW_BLOCKED"


def test_reviewer_scope_and_identity(env):
    draft = env.draft("C001")
    response = env.review(draft, "approve", "other", token=LIMITED)
    assert response.status_code == 404
    body = {"expected_revision": 1, "decision": "approve", "edited_message": None, "feedback": None, "delivery": "draft_only", "approved_by": "SOMEONE"}
    response = env.client.post("/api/v1/drafts/" + draft["draft_id"] + "/review", json=body, headers={"Authorization": "Bearer " + TOKEN, "Idempotency-Key": "inj"})
    assert response.status_code == 422
    assert env.get(draft["draft_id"]) == draft


def test_failed_audit_write_rolls_back_everything(env, monkeypatch):
    draft = env.draft("C004")

    def broken(self, record):
        raise RuntimeError("audit write failed")
    monkeypatch.setattr(repositories.Audit, "add", broken)
    response = env.review(draft, "approve", "boom", delivery="mock_email")
    assert response.status_code == 500
    monkeypatch.undo()
    assert env.rows("SELECT revision, status FROM drafts") == [(1, "ready_for_review")]
    assert env.rows("SELECT COUNT(*) FROM reviews") == [(0,)]
    assert env.rows("SELECT COUNT(*) FROM outbox") == [(0,)]
    assert env.rows("SELECT COUNT(*) FROM idempotency WHERE path LIKE '%review%'") == [(0,)]


def test_concurrent_approvals_have_one_winner(env):
    draft = env.draft("C004")
    engine = PolicyEngine()
    reviewer = env.settings.reviewers[0]
    results = []
    barrier = threading.Barrier(4)

    def attempt(index):
        storage = SQLiteStorage(env.db, clock=env.clock)
        body = ReviewRequest(expected_revision=1, decision="approve", edited_message=None, feedback=None, delivery="mock_email")
        barrier.wait()
        try:
            ReviewService(storage, engine, env.clock).review(draft["draft_id"], body, reviewer, "race%d" % index, "REQ%d" % index)
            results.append("ok")
        except ApiError as error:
            results.append(error.code)
        except Exception as error:
            results.append(type(error).__name__)
    threads = [threading.Thread(target=attempt, args=(i,)) for i in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert results.count("ok") == 1, results
    assert set(results) - {"ok"} <= {"INVALID_TRANSITION", "VERSION_CONFLICT"}, results
    assert env.rows("SELECT COUNT(*) FROM outbox") == [(1,)]
    assert env.rows("SELECT COUNT(*) FROM reviews") == [(1,)]


def test_database_lock_returns_redacted_503(env):
    draft = env.draft("C001")
    blocker = sqlite3.connect(str(env.db), isolation_level=None)
    blocker.execute("BEGIN IMMEDIATE")
    try:
        response = env.review(draft, "approve", "locked")
    finally:
        blocker.rollback()
        blocker.close()
    assert response.status_code == 503 and code(response) == "SERVICE_UNAVAILABLE"
    assert "sqlite" not in response.text.lower() and "C001" not in response.text


def test_pending_reservation_recovers_after_lease(env):
    from app.storage.records import hash_json
    storage = SQLiteStorage(env.db, clock=env.clock)
    scope = IdempotencyScope(actor_id="REVIEWER001", method="POST", path="/api/v1/drafts", key="crashed")
    with storage.unit_of_work() as uow:
        uow.idempotency.reserve(scope, hash_json({"customer_id": "C001", "channel": "email", "locale": "en-IN"}))
        uow.commit()
    response = post_draft(env.client, env.settings, "C001", "crashed")
    assert response.status_code == 409 and response.json()["error"]["retryable"] is True
    assert response.headers.get("retry-after") == "1"
    env.clock.value += timedelta(seconds=91)
    response = post_draft(env.client, env.settings, "C001", "crashed")
    assert response.status_code == 201, response.text
