# Tester cases for SQLite and review

No cases in this file have been executed by the implementation agent. This extends TESTER_HANDOFF.md. Keep the current Phase 3 test server running until that pass is complete; coordinate SQLite activation separately.

## Persistent store

- Seed a fresh isolated database, restart/open a new adapter, and confirm customer/policy/draft/review/audit/outbox/idempotency persistence.
- Reopen an initialized database with a different seed file; existing state must not be replaced. Schema mismatch/unmarked non-CodeVortex files must fail without data deletion.
- Verify foreign keys, review uniqueness and one outbox entry per draft. Inject an audit or database write failure and confirm all related writes roll back.
- Exercise simultaneous independent connections/processes, stale revisions, duplicate approvals and two different drafts for one customer. Contact-frequency/version checks must use the current serialized state.
- Confirm no transaction is held during AI waits/callbacks. Database lock timeout must return a redacted 503 rather than leaking records/SQL values.
- Compare memory/SQLite repository semantics with isolated data. The SQLite adapter stages the whole small dataset; this is not a scalability benchmark claim.

## Human review

- Edit ready/blocked messages: canonical formatting-only edits may pass; unsupported facts, missing footer, wrong offer or sensitive values must fail without changing revision.
- Approve ready draft_only -> approved; approve ready mock_email -> mock_sent and one matching outbox/contact; reject ready/blocked -> rejected, even with consent/billing blocks.
- Blocked approve -> 422. Terminal new action -> 409. Stale expected_revision or changed data/policy/template version -> 409.
- Change consent, eligibility, bill status/freshness, offer expiry or contacts before approval. All current failures must prevent delivery. Approval must not rewrite the message.
- Verify approver identity comes only from bearer auth, never the body, and ownership cannot be bypassed.
- Same key/body replays its stored success without new revisions/outbox/audits; changed body conflicts. Crash after reservation recovers after the 90-second pending lease; completed outcomes last 24 hours.
- After mock delivery, customer data_version changes; another outstanding draft based on the old version must fail approval. No real mail/payment/consent/reward action is possible.
- Failed review must leave no pending reservation or partial writes. Successful response and committed audit/outbox must agree across restart.

Use temporary/isolated SQLite files and an offline AI adapter for automated coverage. Do not mutate the working 50-customer database as a substitute for a test fixture. Runtime uses actual UTC; use trusted clock injection for reproducible billing/expiry boundaries. The agent has neither run nor certified these cases.
