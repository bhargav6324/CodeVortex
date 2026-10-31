# Phase 3 verification handoff

Deployment note: the next SQLite/reviewer implementation is documented in DATABASE_AND_REVIEW.md and TESTER_DATABASE_REVIEW.md. The currently running Phase 3 memory server is deliberately unchanged during the tester's active pass. Statements below describe that Phase 3 baseline; after coordinated SQLite cutover, use the newer review/persistence handoff.

A recorded local run passed 85 offline tests (43 earlier + 42 Phase 3). See VERIFICATION_STATUS.md; that result does not establish live AI/Tailscale integration or SQLite/reviewer behavior. No suites or API checks were rerun for this publication.

## Review targets

Policy: app/services/policy.py. Immutable scoped turns: app/storage/records.py and memory.py. Tool dispatch: app/services/tools.py. Draft orchestration and idempotency: app/services/generation.py. Real peer transport: app/services/ai_client.py. Endpoint shapes remain frozen at 1.0.0.

The default API fixture injects an offline AI adapter and fixed dataset clock to avoid unintended provider calls. tests/test_phase3.py supplies the new Phase 3 coverage. The unregistered-turn expectation is now 403. Additional live integration and SQLite/reviewer verification belongs to the separate tester.

## Functional cases to verify

- All matching segments, stable order, correct reason codes/evidence, null values and no-segment refusal.
- Thresholds: 999/1000 points, 11/12 months, activity ratio exactly 0.5, zero previous activity, dormancy exactly 30 days.
- Strategy precedence for overlapping segments. Reminders contain no promotions. Day 15 requires prior courteous contact before using firm_respectful.
- Active offer interval includes valid_from, excludes expires_at. Plan/points/tenure/marketing consent gating; highest value and lexical ID tie-break. Ineligible offers yield safe no-offer appreciation where applicable.
- Channel denial and marketing/service consent independently produce blocks. Collect all applicable findings.
- Missing/stale/future/disputed/contradictory bills block outreach. C021 and C046 retain known-overdue reminder priority but cannot generate/send with stale verification. Never select a promotional fallback due to stale billing.
- Seven-day contact and content-hash dedupe windows include the lower boundary. Two prior contacts block. Draft-only approvals do not count as delivered history.
- Approved template placeholders only; no expressions, format specs, missing required footer/support path or promotion slots in reminders. Body/subject must equal canonical rendering after CRLF normalization and outer trim. Verify exact two-decimal INR billing format.
- Unsupported benefit/amount/date, unknown offer/template, unapproved links, identifiers, instructions in names, prohibited phrases and evidence changes must fail closed.

## Endpoint and security cases

- GET /health; authorized context/draft reads; absent/out-of-scope IDs conceal existence.
- POST /api/v1/drafts: ready-for-review result with a correctly mocked AI callback flow; blocked 201 with no provider call; unavailable peer 503; timeout 504; malformed provider response rejected.
- Successful identical key/body replays the same draft as 200; changed body 409; concurrent pending key 409 with Retry-After:1. A failed provider call releases only its own uncommitted reservation. Draft and audit/idempotency result commit together.
- POST /internal/v1/tools/execute: separate service credential and a valid registered turn are both required. Test forged/mismatched/expired token, unknown turn, wrong versions/customer/turn ID, repeated evaluation, validation before evaluation and a third tool call. No public token minting route.
- AI cannot skip tools, change the plan, alter validated candidate content or invent evidence. Validate failed candidates become blocked drafts, never ready ones. Backend final checks must catch expiry/contact/customer/policy changes after snapshot capture.
- Review endpoint still returns 503 after authorization/request validation. No approval/outbox/send side effects should exist through HTTP in this phase.
- CORS exposes only the allowed frontend origins/headers. Public/internal body limits and redacted Error responses remain intact.

## Live integration setup

AI team must implement POST /internal/v1/generate and hold the separately provisioned service credential. It must forward the opaque delegation on its two backend callbacks. See AI_TEAM_HANDOFF.md for the handshake. The backend must be reachable at 100.83.115.82:8000 from the AI machine; actual teammate connectivity/firewall behavior is for the tester to confirm.

Runtime uses current UTC. The active 50-record dataset was labelled at 2026-10-31T06:00:00Z; outcomes near time thresholds and billing freshness can change as time passes. For reproducible automated cases inject a trusted fixed clock and isolated storage/AI adapters, never add a public clock parameter. All writes are still process-local memory; restart resets them. No real mail/payment action is in scope.
