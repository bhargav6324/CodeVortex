# CodeVortex

Customer Loyalty and Engagement Assistant for the HCLTech hackathon.

The [FastAPI backend](backend/README.md) includes frozen integration contracts, deterministic customer/offer/billing/consent rules, scoped AI tools, an AI service client and draft generation, SQLite storage, and a human-review/mock-delivery workflow.

- [AI integration handoff](backend/docs/AI_TEAM_HANDOFF.md)
- [SQLite and reviewer setup](backend/docs/DATABASE_AND_REVIEW.md)
- [Tester handoff](backend/docs/TESTER_HANDOFF.md)
- [Database and review cases](backend/docs/TESTER_DATABASE_REVIEW.md)

Phase 3 has a recorded local offline result of 85 passing tests. Live AI integration and SQLite/reviewer verification remain pending; tests were not rerun for this publication. SQLite activation requires the documented configuration and restart. Real email sending and autonomous financial actions are outside scope.

Credentials, local project memory, incoming datasets and runtime database files are excluded. Synthetic development fixtures and a placeholder-only environment example are provided.
