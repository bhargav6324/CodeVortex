# Persistent storage and human review handoff

Source implementation for the next backend phase. The running Phase 3 server is deliberately not restarted while the tester is using it. No API request, test suite or policy execution was run by the implementation agent. Syntax review is not functional verification.

## SQLite choice and layout

SQLite is the local hackathon persistence choice for the existing 50-customer workload. It uses Python's standard library; no separate database server or new package is required. This is a single-host adapter, not a distributed storage solution.

Database path: data/codevortex.sqlite3. Schema: app/storage/schema.sql. Tables: metadata, contexts, offers, customer_offers, policy, drafts, reviews, outbox, audit, idempotency and turns. Offers have one normalized master definition; per-customer offer assignments are reconstructed for the frozen Context response. Context/DTO payloads use JSON text with indexed relational keys, foreign keys, unique review revisions and a unique outbox draft_id. Evaluation labels are not stored in runtime tables.

Transactions use BEGIN IMMEDIATE and a five-second busy timeout. Shared repository code performs validation/copy isolation; SQLite atomically commits changed rows. Failed audit/review/delivery writes roll back the whole transaction. No network await holds a unit of work open. Busy/unavailable storage returns the existing 503 Error envelope. Schema version is 1; incompatible/unmarked databases are not overwritten.

The adapter stages the small dataset in memory per short transaction and persists differences. This favors consistent behavior with the development adapter over large-scale throughput. Keep one worker for the demo even though SQLite locking also serializes independent connections. Migration to a larger database can implement the same repository ports.

## Initial setup and cutover

The setup command creates the actual database and imports seed records once. It is not a policy or API test:

```sh
cd backend
.venv/bin/python scripts/init_database.py --database data/codevortex.sqlite3 --dataset data/dataset.json
```

An initialized database is preserved; rerunning does not reset customer/contact/draft/review/outbox state or reload changed JSON. Versioned data/policy updates require an explicit import/migration. Never delete the database as part of a routine restart.

When the tester has finished with the current server, coordinate a restart with these private local environment settings:

```dotenv
STORAGE_BACKEND=sqlite
DATABASE_PATH=data/codevortex.sqlite3
DATASET_PATH=data/dataset.json
DRAFT_FIXTURE_PATH=
```

After stopping the existing process at the agreed cutover time, start with the existing Tailscale command. To select SQLite without changing .env, the operator can instead use startup overrides:

```sh
STORAGE_BACKEND=sqlite DATABASE_PATH=data/codevortex.sqlite3 .venv/bin/python -m uvicorn app.main:create_app --factory --host 100.83.115.82 --port 8000
```

Do not run that command concurrently with the current port-8000 process. The running process remains on memory until a coordinated restart; saving code alone does not switch it. Do not launch a competing server on port 8000 or stop the current tester session silently. Current in-memory drafts are not automatically copied to SQLite. Complete the active test run first; for the SQLite test pass, regenerate drafts through the normal flow, or plan an explicit migration if those transient drafts must be retained.

The backend can also initialize a fresh SQLite file at first startup, but later startups open the persisted data without requiring/reimporting the seed file. Database/WAL files, incoming datasets, memory and credentials remain ignored by Git. New database files are created with owner-only permissions.

## Existing reviewer endpoint

POST /api/v1/drafts/{draft_id}/review is now implemented for STORAGE_BACKEND=sqlite. On memory configuration it still returns 503 after access checks, preserving the current Phase 3 behavior and preventing approval without persistence. Request and response bodies remain the frozen ReviewRequest/Draft. Use a reviewer bearer credential, Idempotency-Key and the revision actually inspected.

Edit example:

```json
{
  "expected_revision":1,
  "decision":"edit",
  "edited_message":{"subject":"Approved rendered subject","body":"Approved rendered body"},
  "feedback":"Formatting correction",
  "delivery":"draft_only"
}
```

The strings above are placeholders for the canonical message, not a valid factual draft. Edits must still match the approved template after CRLF normalization and outer trim. A successful edit increments revision and returns ready_for_review without approving. Failure returns 422 REVIEW_BLOCKED with finding codes; draft/revision stay unchanged.

Approve and mock-deliver example:

```json
{
  "expected_revision":2,
  "decision":"approve",
  "edited_message":null,
  "feedback":null,
  "delivery":"mock_email"
}
```

Approval re-reads data/policy/templates, checks versions, verifies current consent/eligibility/billing/expiry, revalidates content, checks recent contacts and duplicate content, and records the authenticated approver. A changed snapshot version is 409 VERSION_CONFLICT; a current safety failure is 422 REVIEW_BLOCKED. Blocked drafts cannot be approved directly. Approval never silently edits the draft.

Approval with delivery=draft_only returns terminal approved. Approval with mock_email returns terminal mock_sent with one delivery_id. Both increment revision. There is no later send endpoint for a draft-only approval.

Reject example:

```json
{
  "expected_revision":1,
  "decision":"reject",
  "edited_message":null,
  "feedback":"Please regenerate this draft",
  "delivery":"draft_only"
}
```

Rejection works for ready or blocked drafts and does not require content/consent to pass. It still requires access and a current revision. Terminal states reject new actions with 409 INVALID_TRANSITION; a matching completed idempotency key can still replay its original successful response.

## Atomic mock delivery and idempotency

The review transaction writes the new draft revision, reviewer record, audit, optional outbox/contact update and completed idempotency response together. Mock delivery only inserts a local outbox row; there is no SMTP/provider call. The outbox requires a matching recorded human approval, correct customer/campaign/content hash and a unique draft ID. A new contact bumps customer data_version, so other outstanding drafts must be regenerated before approval.

Completed generation/review outcomes are retained for 24 hours. Pending reservations have a 90-second lease, longer than the generation budget, so a process crash cannot leave the key pending all day. Failed transactions leave no successful outcome; final draft/audit/outcome persistence is atomic. Same key with changed body conflicts. Concurrent requests are serialized and revisions are checked before commit. The tester must verify these properties; no passing result is claimed here.

## Scope still pending

Tester execution of SQLite/reviewer cases and AI-team integration; coordinated cutover from the active memory server; rate limiting/retention maintenance and final evaluation/documentation. No real email, payment, refund, plan change, reward redemption, bulk outreach or consent modification is included.
