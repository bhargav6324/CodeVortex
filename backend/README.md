# CodeVortex backend

FastAPI backend for the Customer Loyalty and Engagement Assistant. Phases 1–3 plus the next persistent-storage/review phase are implemented in source: contract models, authentication, storage interfaces and memory adapter, deterministic policy rules, scoped AI tools and the draft-generation bridge. Verification belongs to the separate tester; no new test suites or API requests were run by the implementation agent. The active Phase 3 process is not restarted during the tester’s current pass.

Integration contracts are in contracts/. Read docs/AI_TEAM_HANDOFF.md for the AI handshake and docs/DATABASE_AND_REVIEW.md for SQLite/reviewer setup.

## Run locally

Use Python 3.9 or newer. The pinned dependencies were verified on Python 3.9.6.

```sh
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python scripts/create_local_env.py
.venv/bin/python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

If .venv and .env already exist, skip their creation. Never commit .env. The provisioning script creates random, different credentials and a reviewer token with a 24-hour expiry; it never overwrites an existing file. Its explicit allowed IDs are CUST001–CUST050, but only CUST001–CUST006 exist in the bundled temporary dataset. Permission to an ID does not imply a customer row exists. Rotate/reprovision expiring credentials locally without exposing them in logs, chat or memory.

Open http://127.0.0.1:8000/docs for API definitions and http://127.0.0.1:8000/health for liveness. Use --host 100.83.115.82 only on the backend's actual Tailscale machine. Tailnet connectivity has not been tested here. Use one worker with the temporary in-memory adapter; restart resets its writes. Memory mode opens no database; SQLite mode opens the local persistent file. Neither mode performs real email delivery. For permitted generation requests, the backend calls the configured AI service; blocked prechecks skip it.

Recorded Phase 3 result: 85 offline tests passed in the local working environment, including the separately held 50-customer dataset. Live AI/Tailscale integration and SQLite/reviewer verification remain pending. Tests were not rerun for this publication. See docs/TESTER_HANDOFF.md and docs/TESTER_DATABASE_REVIEW.md; local dataset-dependent cases may skip in a clean clone.

## Current API behavior

| Route | Behavior |
|---|---|
| GET /health | 200 liveness without auth |
| GET /api/v1/customers/{customer_id}/context | 200 permitted context; 404 absent/outside scope |
| POST /api/v1/drafts | Deterministic precheck; 201 blocked draft or AI-backed draft; 200 successful replay; 503/504 for unavailable AI |
| GET /api/v1/drafts/{draft_id} | 200 saved fixture draft, with actual customer ownership check; 404 otherwise |
| POST /api/v1/drafts/{draft_id}/review | SQLite: transactional edit/approve/reject and mock ledger; memory: 503 after access checks |
| POST /internal/v1/tools/execute | Evaluate customer or validate candidate against a registered scoped turn; 200 policy result |

AI team owns POST /internal/v1/generate; the backend contains its exchange models, not that route. Draft creation now reserves/replays idempotency results and saves the draft/audit/result together. Review execution requires STORAGE_BACKEND=sqlite. Mock delivery is a local ledger only, never a real email. See docs/AI_TEAM_HANDOFF.md and docs/BACKEND_PHASE3.md for the implemented handshake.

## Team network startup

For the supplied backend Tailscale host, start with:

```sh
.venv/bin/python -m uvicorn app.main:create_app --factory --host 100.83.115.82 --port 8000
```

This binds the Tailscale interface instead of localhost. Docs are at http://100.83.115.82:8000/docs. Only one backend process/worker should own the in-memory store. The tester must confirm peer reachability and firewall rules; process startup alone does not prove another machine can connect.

## Storage and fixture configuration

Storage is accessed through app/storage/interfaces.py and injected through create_app(settings, storage) or the get_storage dependency. The memory adapter provides context/policy reads, draft inserts and revision-checked updates, review and audit records, a unique mock outbox with contact records, and scoped completed idempotency results (24 hours) and pending reservations (90 seconds). Transactions require an explicit commit and roll back on exceptions. Read results are deep copies. The memory adapter is for development. SQLite supplies persistence, relational constraints and transaction serialization; see docs/DATABASE_AND_REVIEW.md for its small-workload limits.

Development-mode fixtures: fixtures/dataset.json has six synthetic scenarios, one policy and evaluation labels; fixtures/drafts.json has DRAFT001 for CUST001. The sample draft is marked model_version=fixture_not_invoked. It is not live Gemini output, and labels are not measured model results. Runtime storage discards evaluation labels. See fixtures/README.md for scenario details.

Existing .env files need no changes for default fixtures. Optional configuration:

```dotenv
STORAGE_BACKEND=memory
DATASET_PATH=fixtures/dataset.json
DRAFT_FIXTURE_PATH=fixtures/drafts.json
```

Relative paths resolve from this backend folder, independently of the shell's current folder. A different DATASET_PATH defaults to no sample drafts; an empty DRAFT_FIXTURE_PATH explicitly disables them. The loader rejects invalid shapes, IDs/relationships, contradictory basic billing, future observed timestamps and inconsistent repeated offers before startup. Imported labels are kept out of application/AI inputs; their correctness is evaluated in Phase 3. The local full dataset has been received. SQLite uses the same import checks and seeds only once; subsequent restarts preserve stored data.

## Current local dataset

The private local environment now selects data/dataset.json with 50 customers C001–C050 and no sample draft fixtures. Reviewer permissions were aligned to those IDs. The original file and correction report are retained in the ignored data/ folder. These local files are not included in the public repository. The running server remains on memory for the ongoing test pass. SQLite storage/review code is prepared separately; see docs/DATABASE_AND_REVIEW.md for the coordinated cutover.

## Contract and security

contracts/schema.json contains 31 frozen schema definitions. app/models.py is generated by scripts/extract_contract.py from contracts/AI_SERVICE_CONTRACT.md. Both Markdown handoffs are included locally and their shared sections must stay identical. Change both handoffs before regenerating public DTOs. Storage records are separate internal models, not additional public fields.

All required fields, nullability, strict primitive types, enums, bounds and calendar formats are enforced. ReviewRequest additionally checks edit/approve/reject combinations. Phase 3 policy code checks consent, evidence freshness, eligibility and canonical text; schema validation alone is not sufficient. The tester must verify the new behavior.

Reviewers use independent expiring bearer credentials with explicit customer scopes. Backend-to-AI and AI-to-backend credentials are distinct; only the backend holds the HMAC signing secret. Scoped delegation binds customer, turn, snapshot versions, audience codevortex-ai-turn and a maximum 60-second lifetime. The tool route now checks the stored turn, versions, expiry, call order and validated candidate. Tools cannot mint or modify their own snapshot. There is no public token issuance/login endpoint.

Every response carries X-Request-ID, X-Contract-Version and Cache-Control:no-store. Errors use the frozen Error body and do not echo raw customer inputs or credentials. JSON bodies are limited to 64 KiB public / 256 KiB internal. CORS permits only explicit frontend origins. Mock-outbox storage has no SMTP/network operation. SQLite review routes include human approval, fresh deterministic checks and atomic audit/outbox handling. The running memory deployment leaves review disabled until a coordinated SQLite restart.

Implementation references: FastAPI [validation errors](https://fastapi.tiangolo.com/tutorial/handling-errors/), [CORS](https://fastapi.tiangolo.com/tutorial/cors/), and Pydantic [strict mode](https://docs.pydantic.dev/latest/concepts/strict_mode/).

## Backend handoffs and remaining work

- docs/AI_TEAM_HANDOFF.md: exact service handshake, tool arguments and credentials by role.
- docs/BACKEND_PHASE3.md: backend responsibilities, lifecycle and constraints.
- docs/TESTER_HANDOFF.md: Phase 3 cases for the separate tester.
- docs/DATABASE_AND_REVIEW.md: SQLite schema/setup, review payloads and cutover.
- docs/TESTER_DATABASE_REVIEW.md: persistence, approval and concurrency cases not yet executed.

The AI team must supply its POST /internal/v1/generate implementation. The backend uses current UTC, not the fixed seed clock. SQLite and review are now implemented for the next deployment; tester verification, coordinated cutover, rate limits/retention and integrated evaluation remain. No real email, financial operation or redemption is enabled.
