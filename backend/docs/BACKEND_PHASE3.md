# Backend Phase 3 implementation

Deployment note: the next SQLite/reviewer implementation is documented in DATABASE_AND_REVIEW.md and TESTER_DATABASE_REVIEW.md. The currently running Phase 3 memory server is deliberately unchanged during the tester's active pass. Statements below describe that Phase 3 baseline; after coordinated SQLite cutover, use the newer review/persistence handoff.

User instruction: API verification belongs to the separate tester. No API requests, policy executions or automated suites were run for this phase. Read TESTER_HANDOFF.md before claiming any verification results. The historical 43-test count is not a Phase 3 result.

## Implemented source

| Module | Responsibility |
|---|---|
| app/services/policy.py | Pure rule-based classification/evidence, strategy, offers, consent, billing, contacts, templates and content validation |
| app/services/tools.py | Customer/version/turn-scoped evaluate_customer and validate_draft dispatch |
| app/services/generation.py | Reviewer draft request, immutable turn creation, scoped token, AI call, response verification and independent final checks |
| app/services/ai_client.py | Bounded HTTP transport to the AI team's generation endpoint |
| app/storage/records.py | Internal TurnSnapshot (not a new public field) |
| app/storage/interfaces.py | TurnRepository port |
| app/storage/memory.py | Copy-isolated, expiring turn storage and tool-call consumption metadata |
| app/clock.py | Trusted UTC clock utilities |

Public wire schemas and paths remain version 1.0.0. app/models.py and both frozen handoff contracts were not changed. HTTPX is now a runtime dependency because the backend implements the AI service client; it was already installed in the development environment.

## Endpoint behavior

- GET /health: liveness.
- GET /api/v1/customers/{customer_id}/context: permitted stored context.
- POST /api/v1/drafts: deterministic precheck, then blocked resource or AI-backed generation. Requires a reviewer credential and Idempotency-Key. New resources are 201, successful replay 200. A blocked draft is a successful reviewable resource and is never sent.
- GET /api/v1/drafts/{draft_id}: generated/blocked draft with customer ownership check.
- POST /internal/v1/tools/execute: live deterministic tools for a backend-registered, unexpired turn. Requires service credential and opaque signed delegation. Tools cannot update customer/offer/consent/billing/draft state. Only request-consumption metadata is updated.
- POST /api/v1/drafts/{draft_id}/review: still 503 after validation/authorization; transactional approval/delivery is a later phase.
- POST /internal/v1/generate: implemented by the AI team at 100.114.163.7:8001, not by this backend.

## Turn and generation lifecycle

Generate opens a 60-second immutable AIRequest+Plan snapshot after a passing precheck. It signs customer, turn and data/policy/template versions. The AI service gets that snapshot and capability and must evaluate once then validate once through the backend. Unknown/expired/unregistered/mismatched turns return 403. Duplicate or out-of-order calls return 409 INVALID_TRANSITION. Calls cannot register their own context, inject facts or extend expiry.

No unit of work is held across network awaits. A committed idempotency reservation precedes AI work. The bounded AI call is at most 25 seconds; provider transport failures become redacted 503/504 errors. Backend requires both tools to have been consumed and verifies the plan, candidate hash, validation result, model status and evidence fields/values. It compares current customer/policy against the original snapshot and recomputes content/policy at actual current UTC time before saving. Gateway and final blocking findings are combined; a later pass cannot erase an earlier tool failure. Sensitive candidates are not retained as draft text.

Draft, audit and completed idempotency result commit together; the turn is revoked on success. Cancellation/failure deletes its turn and releases only its own uncommitted reservation. Successful results cannot be released. The memory store is still process-local and not a durable database. Use one worker until the database adapter exists.

## Policy choices carried forward

All matching segments appear in the agreed order with exact factual evidence and confidence=1 for matched rules. Unknown activity/payment values are not zero. Stale known-overdue bills retain payment-reminder priority while BILLING_UNVERIFIED blocks outreach; no promotional fallback. Collect all applicable blocking findings.

Reminder progression is configured, respectful and requires prior courteous contact before a firm reminder. Promotions never appear in reminders. All email requires channel permission; marketing/service permission applies per objective. Offer selection uses active dates, plan, points, tenure, consent and deterministic tie-breaks. Seven-day campaign/frequency checks and normalized message hashes enforce dedupe.

Approved placeholders are allowlisted; no attribute access, conversion, format expressions or nested evaluation. Template rendering uses exact verified slots. Canonical subject/body comparison permits CRLF normalization and outer whitespace trim only. Unapproved links/identifiers, suspicious instructions, blocked phrases and unresolved placeholders fail closed. This intentionally limits text variety; it is not a free-text factual verifier. No protected attribute/proxy participates in rules.

## Remaining work

Separate tester verification and live AI-team handshake; final database choice/adapter; durable concurrency/idempotency; rate limits/retention cleanup; transactional edit/approval/rejection/outbox; broader operational controls and evaluation report. No real mail, financial action or autonomous redemption is implemented. No new GitHub push was made in this phase.
