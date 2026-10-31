# AI service evaluation

Generated 2026-10-31T08:14:06Z from real turns recorded by the AI service. Labels: `dataset.json`. Turns: `eval-data/runs.jsonl`.

These are results on a small synthetic labelled set supplied by the backend, not a production accuracy claim.

## Summary

| Metric | Result |
| --- | --- |
| Labelled customers with a recorded turn | 50/50 (100%) |
| Segment exact match (set equality) | 42/50 (84%) |
| Objective match | 47/50 (94%) |
| Expected-block cases blocked with the expected codes | 21/22 (95%) |
| Expected-pass cases generated | 28/28 (100%) |
| Model candidates passing validate_draft (slot/policy correctness) | 29/29 (100%) |
| Turns `unavailable` (model failures) | 0/50 (0%) |
| Turns ending in an HTTP error | 0/50 (0%) |
| Turn latency p50 / max | 2389.5 ms / 7908 ms |
| Model version(s) | gemini-3.5-flash-lite, not_invoked |
| Prompt version(s) | backend_policy_v1, prompt_v1 |

## Per-segment precision and recall

| Segment | Precision | Recall | Support |
| --- | --- | --- | --- |
| consistent | 1.00 | 1.00 | 15 |
| loyalty_candidate | 1.00 | 0.95 | 19 |
| declining_activity | 0.54 | 1.00 | 7 |
| dormant | 1.00 | 1.00 | 5 |
| payment_reminder | 0.91 | 1.00 | 10 |

## Per customer

| Customer | Expected segments | Got | Expected objective | Got | Expected block codes | Finding codes | Outcome | OK |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C001 | consistent | consistent | appreciation | appreciation | — | — | generated | yes |
| C002 | consistent | consistent | appreciation | appreciation | — | — | generated | yes |
| C003 | consistent | consistent | appreciation | appreciation | — | — | generated | yes |
| C004 | loyalty_candidate | loyalty_candidate | reward | reward | — | — | generated | yes |
| C005 | loyalty_candidate | loyalty_candidate | reward | reward | — | — | generated | yes |
| C006 | loyalty_candidate | loyalty_candidate | reward | reward | — | — | generated | yes |
| C007 | loyalty_candidate | loyalty_candidate | appreciation | appreciation | CONSENT_REQUIRED | CONSENT_REQUIRED | blocked | yes |
| C008 | declining_activity | declining_activity | reengagement | reengagement | — | — | generated | yes |
| C009 | declining_activity | declining_activity | reengagement | reengagement | — | — | generated | yes |
| C010 | declining_activity | declining_activity | reengagement | reengagement | CHANNEL_BLOCKED | CHANNEL_BLOCKED, CONSENT_REQUIRED | blocked | yes |
| C011 | dormant | dormant, declining_activity | reengagement | reengagement | — | — | generated | NO |
| C012 | dormant, consistent | dormant, declining_activity, consistent | reengagement | reengagement | — | — | generated | NO |
| C013 | dormant | dormant, declining_activity | reengagement | reengagement | — | — | generated | NO |
| C014 | payment_reminder | payment_reminder | payment_reminder | payment_reminder | — | — | generated | yes |
| C015 | payment_reminder | payment_reminder | payment_reminder | payment_reminder | — | — | generated | yes |
| C016 | payment_reminder | payment_reminder | payment_reminder | payment_reminder | — | — | generated | yes |
| C017 | payment_reminder | payment_reminder | payment_reminder | payment_reminder | — | — | generated | yes |
| C018 | payment_reminder | payment_reminder | payment_reminder | payment_reminder | CONSENT_REQUIRED | CONSENT_REQUIRED | blocked | yes |
| C019 | loyalty_candidate | — | reward | — | BILLING_DISPUTED | MISSING_EVIDENCE, BILLING_DISPUTED | blocked | NO |
| C020 | loyalty_candidate, consistent | loyalty_candidate, consistent | reward | reward | BILLING_UNVERIFIED | BILLING_UNVERIFIED | blocked | yes |
| C021 | loyalty_candidate | payment_reminder, loyalty_candidate | reward | payment_reminder | BILLING_UNVERIFIED | BILLING_UNVERIFIED | blocked | NO |
| C022 | loyalty_candidate | loyalty_candidate | appreciation | appreciation | — | — | generated | yes |
| C023 | — | — | — | — | MISSING_EVIDENCE | MISSING_EVIDENCE | blocked | yes |
| C024 | — | — | — | — | MISSING_EVIDENCE | MISSING_EVIDENCE | blocked | yes |
| C025 | loyalty_candidate, consistent | loyalty_candidate, consistent | reward | reward | DUPLICATE_OUTREACH | DUPLICATE_OUTREACH | blocked | yes |
| C026 | loyalty_candidate, consistent | loyalty_candidate, consistent | reward | reward | CONTACT_FREQUENCY | CONTACT_FREQUENCY | blocked | yes |
| C027 | — | — | — | — | MISSING_EVIDENCE | MISSING_EVIDENCE, BILLING_UNVERIFIED | blocked | yes |
| C028 | loyalty_candidate, consistent | loyalty_candidate, consistent | reward | reward | — | — | generated | yes |
| C029 | declining_activity, loyalty_candidate | declining_activity, loyalty_candidate | reengagement | reengagement | — | — | generated | yes |
| C030 | dormant, loyalty_candidate | dormant, declining_activity, loyalty_candidate | reengagement | reengagement | — | — | generated | NO |
| C031 | — | — | — | — | MISSING_EVIDENCE | MISSING_EVIDENCE | blocked | yes |
| C032 | loyalty_candidate | loyalty_candidate | reward | reward | — | — | generated | yes |
| C033 | declining_activity | declining_activity | reengagement | reengagement | — | — | generated | yes |
| C034 | — | declining_activity | — | reengagement | MISSING_EVIDENCE | — | generated | NO |
| C035 | payment_reminder | payment_reminder | payment_reminder | payment_reminder | — | — | generated | yes |
| C036 | consistent | consistent | appreciation | appreciation | CHANNEL_BLOCKED | CHANNEL_BLOCKED | blocked | yes |
| C037 | loyalty_candidate | loyalty_candidate | appreciation | appreciation | — | — | generated | yes |
| C038 | — | — | — | — | BILLING_DISPUTED, MISSING_EVIDENCE | MISSING_EVIDENCE, BILLING_DISPUTED | blocked | yes |
| C039 | consistent | consistent | appreciation | appreciation | BILLING_UNVERIFIED | BILLING_UNVERIFIED | blocked | yes |
| C040 | declining_activity | declining_activity | reengagement | reengagement | CONSENT_REQUIRED | CONSENT_REQUIRED | blocked | yes |
| C041 | payment_reminder, loyalty_candidate, consistent | payment_reminder, loyalty_candidate, consistent | payment_reminder | payment_reminder | — | — | generated | yes |
| C042 | loyalty_candidate, consistent | loyalty_candidate, consistent | reward | reward | — | — | generated | yes |
| C043 | payment_reminder | payment_reminder | payment_reminder | payment_reminder | DUPLICATE_OUTREACH | DUPLICATE_OUTREACH | blocked | yes |
| C044 | — | — | — | — | CONTACT_FREQUENCY, MISSING_EVIDENCE | MISSING_EVIDENCE, CONTACT_FREQUENCY | blocked | yes |
| C045 | dormant | dormant, declining_activity | reengagement | reengagement | CONSENT_REQUIRED | CONSENT_REQUIRED | blocked | NO |
| C046 | payment_reminder, loyalty_candidate | payment_reminder, loyalty_candidate | payment_reminder | payment_reminder | BILLING_UNVERIFIED | BILLING_UNVERIFIED | blocked | yes |
| C047 | consistent | consistent | appreciation | appreciation | — | — | generated | yes |
| C048 | — | — | — | — | MISSING_EVIDENCE | MISSING_EVIDENCE | blocked | yes |
| C049 | payment_reminder, loyalty_candidate, consistent | payment_reminder, loyalty_candidate, consistent | payment_reminder | payment_reminder | — | — | generated | yes |
| C050 | declining_activity, consistent | declining_activity, consistent | reengagement | reengagement | — | — | generated | yes |

## Not measured here

- Reviewer relevance, clarity and tone ratings: collected by the backend's review flow.
- Segment and objective decisions are the backend's deterministic rules; these rows check that the AI service passes them through unchanged.
## Analysis of the 8 mismatched rows

All 8 disagree with the label, not with the contract's frozen rules. The backend's output follows the rules for the data in `dataset.json`. The AI service returned the backend's segments and objectives unchanged in every turn. Draft creation ran on 2026-10-31 between 07:57 and 08:20 UTC (dataset clock 06:00 UTC), before the 24-hour billing cutoff.

| Customers | Label says | Backend returned | Why the backend matches the contract |
| --- | --- | --- | --- |
| C011, C012, C013, C030, C045 | `dormant` without `declining_activity` | `dormant` + `declining_activity` | Each has `activity_current_30d=0` and `activity_previous_30d>0`, so 0 ≤ 0.5 meets rule 3 (declining) as well as rule 4 (dormant). The contract's own `dormant.json` scenario expects "dormant + declining_activity". |
| C034 | no segment → blocked `MISSING_EVIDENCE` | `declining_activity` → reengagement, generated | Activity 6 → 0 meets rule 3. Last activity 2026-10-02 is 29 days before the dataset clock, so not dormant. Timely payments unknown, so not consistent. One segment matches, so there is no missing-evidence block. |
| C019 | `loyalty_candidate` / reward + `BILLING_DISPUTED` | no segment + `MISSING_EVIDENCE`, `BILLING_DISPUTED` | 600 loyalty points < 1000, so rule 2 fails and no rule matches. The expected block code is still present. |
| C021 | `loyalty_candidate` / reward + `BILLING_UNVERIFIED` | `payment_reminder` + `loyalty_candidate` / payment_reminder + `BILLING_UNVERIFIED` | Overdue bill verified 2026-10-30T00:00Z (30 h old > 24 h) → unverified, blocked as expected. The labels treat this case inconsistently: C046 has the same stale-overdue situation, and its label includes `payment_reminder` / payment_reminder. |

Correcting these 8 labels to the contract's rules would make every row match. The open question for the backend team is whether the intended behaviour for C021/C046 is to keep the `payment_reminder` segment on a stale bill. The final status (blocked, `BILLING_UNVERIFIED`) is right either way.

## AI service view of the same run

- 30 generate calls reached the AI service: 29 from this evaluation plus 1 from another team member using the shared server. All 30 were `generated`.
- Every turn made exactly 2 tool calls and 1 Gemini attempt. No repairs, no `unavailable`, no timeouts.
- Every Gemini candidate passed the backend's `validate_draft` (canonical template text, exact slots).
- 21 blocked customers never reached the AI service (pre-blocked by the backend, `model_version=not_invoked`), as designed.
- Known weakness: in 7 of 30 turns (6 appreciation, 1 reengagement), Gemini cited no evidence fields. This is allowed by the contract but less useful to reviewers. A prompt change can require at least the segment evidence.
