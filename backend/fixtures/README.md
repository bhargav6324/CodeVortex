# Temporary development fixtures

These files are synthetic inputs for the in-memory adapter, not the pending full dataset or measured model results. The frozen evaluation clock is 2026-10-31T06:00:00Z. Policy thresholds are demo choices.

| Customer | Scenario | Expected objective after Phase 3 |
|---|---|---|
| CUST001 Asha | Loyal and consistent, eligible OFFER100 | reward |
| CUST002 Ravi | Consistent, below loyalty threshold | appreciation |
| CUST003 Mira | Declining activity | reengagement |
| CUST004 Dev | Dormant and declining | reengagement |
| CUST005 Nila | Verified overdue INR 1499.00 | payment_reminder, courteous |
| CUST006 Kiran | Loyal/consistent, marketing consent false | appreciation candidate, blocked CONSENT_REQUIRED |

`dataset.json` follows the frozen Dataset schema and contains one policy, permitted contexts and evaluation labels. Runtime storage discards labels. `drafts.json` contains DRAFT001 for CUST001, ready_for_review, revision 1, not_sent. Its model_version is fixture_not_invoked; no Gemini call took place. Phase 2 validates structure and import integrity, not predicted classification or full content-policy compliance.

When the external dataset arrives, use DATASET_PATH to select it. The loader disables sample drafts by default for a different dataset; set DRAFT_FIXTURE_PATH explicitly only if those drafts reference the selected dataset and its versions. Use an empty DRAFT_FIXTURE_PATH to load no draft fixtures. Do not append the pending 50-record dataset to these six records without checking IDs/labels/offer consistency.
