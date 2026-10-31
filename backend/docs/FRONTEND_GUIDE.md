# CodeVortex frontend guide: tabs, API and rules

From: Backend (Bhargav). For: Frontend developer. Date: 31 October 2026.

This guide says what the frontend should show and exactly how to get each piece from the backend. It follows the frozen contract `1.0.0` (`contracts/FRONTEND_CONTRACT.md`). Anything marked **Proposed** does not exist yet and must stay hidden until `/health` reports a newer contract version.

## 1. Current backend state

| Item | Value |
|---|---|
| Backend URL | `http://100.83.115.82:8000` (API docs at `/docs`) |
| Contract | `1.0.0` |
| Storage | SQLite: drafts, reviews, audit and mock outbox survive restarts |
| AI | Live: Gemini `gemini-3.5-flash-lite` through the AI service. A draft usually takes 2–6 seconds |
| Review (edit / approve / reject) | **Working** |
| Rate limits | 20 draft generations and 60 reads/reviews per minute **per reviewer token** |
| Customers | `C001` to `C050` (no customer-list API; keep the list in the frontend) |
| Login | None. The reviewer pastes a token we give them. No admin role |

### How the AI is connected

The AI is already integrated and tested end to end. The frontend does nothing extra to use it: one call, `POST /api/v1/drafts`, runs the whole chain.

1. The backend loads the customer and applies the rules: segments, strategy, offer, consent and billing checks.
2. If the rules already block the customer (no consent, disputed bill and so on), the backend saves a blocked draft straight away. The AI is not called, and `versions.model_version` is `not_invoked`.
3. Otherwise the backend calls the AI service (`100.114.163.7:8001`). Gemini writes the email from the approved template, and the AI service asks the backend's tools to confirm the plan and validate the text.
4. The backend re-checks the AI's result and saves the draft as `ready_for_review` (or `blocked` if the text failed). `versions.model_version` shows the Gemini model.

Live results on 31 October: all nine demo customers in section 6 gave the expected outcome, and C001 took 5.8 seconds with `gemini-3.5-flash-lite`. If the AI service is down, draft creation returns 503 (or 504 on timeout) and no draft is saved.

## 2. Tabs to build

| Tab | Purpose | Backend support |
|---|---|---|
| 1. Review workspace | Pick a customer, see facts, generate, edit, approve, reject | Fully supported now |
| 2. AI assistant (conversation) | The same workflow shown as a chat with the assistant | Fully supported now (UI over the same endpoints) |
| 3. Statistics | Counts, block reasons, latency, outcomes | Session-based now; full stats **Proposed** |
| 4. Audit and outbox | Per-draft history and the mock email record | **Proposed** (v1.1 `/details`) |
| Header: system status | Backend up, contract version | Supported now (`/health`) |

### Tab 1: Review workspace

Layout: customer picker on the left; three panels on the right.

1. **Customer facts** from `GET /api/v1/customers/{id}/context`: name, plan, tenure, loyalty points, activity (current and previous 30 days), last activity, payment history, consent (email, marketing, service email), billing (status, amount in INR, due date, verified time, dispute), recent contacts and offers.
2. **Decision** from the `Draft`: every segment with its reason codes, confidence and evidence (field and value exactly as returned), the strategy (objective, tone, template, reminder stage), the selected offer, and validation findings.
3. **Email preview and actions**: subject and body as plain text (keep line breaks), status badge, revision number, and the buttons below.

| Draft status | Buttons |
|---|---|
| `ready_for_review` | Edit, **Approve draft** (default), **Approve and mock-send** (explicit choice), Reject |
| `blocked` | Show the findings and the support text; Edit and Reject only. Approve is disabled |
| `approved`, `rejected`, `mock_sent` | None (final). Offer "Generate a new draft" |

Show "Mock sent" only when the response says `mock_sent`. Never mark anything approved or sent before the response arrives.

### Tab 2: AI assistant (conversation view)

A chat-style view of the same workflow, for demos. **It is not free chat with Gemini.** The browser never talks to the AI service or Gemini; every message maps to one of the four backend calls. Do not show prompts or model reasoning; the backend never returns them.

Suggested flow:

| Reviewer says or clicks | Frontend calls | Assistant replies with |
|---|---|---|
| "Draft an email for C004" or picks a customer | `GET` context, then `POST /api/v1/drafts` | A "thinking" bubble while waiting, then a step-by-step answer (below) |
| "Edit" (opens the message in an editor) | `POST .../review` with `decision: "edit"` | The new revision and its checks, or the refusal reasons |
| "Approve" / "Approve and mock-send" | `POST .../review` with `decision: "approve"` | Final status, approver and time, delivery ID for mock-send |
| "Reject" plus a reason | `POST .../review` with `decision: "reject"` and `feedback` | "Rejected", with the feedback |
| Anything else | No call | "I can draft, edit, approve or reject emails for C001–C050." |

Build the assistant's answer from the Draft fields, as separate bubbles:

1. **Who this customer is:** each segment and its reason, with the evidence values ("1,200 loyalty points, 18 months tenure → loyalty candidate").
2. **What I recommend:** objective and tone, plus the offer if one was selected.
3. **The draft:** subject and body.
4. **Safety checks:** "All checks passed", or each finding with its code and message.
5. **Footer:** `model_version` (shows `not_invoked` when the AI was not needed because the plan was blocked), `prompt_version`, `request_id` and how long it took.

Quick-reply chips: "Draft for C001", "C004 (reward)", "C014 (payment reminder)", "C007 (blocked)". Keep the conversation in memory only; it disappears on reload, apart from the draft IDs (section 5).

### Tab 3: Statistics

**What works today.** The backend has no list or statistics endpoint in 1.0.0, so statistics cover the drafts this browser session created or opened. Keep their IDs in `sessionStorage`, then call `GET /api/v1/drafts/{id}` when the tab opens or the user presses Refresh. Don't poll in a loop: every refresh counts against the 60-per-minute limit.

Cards and charts you can compute from those drafts:

- Total drafts, and counts by status: ready, blocked, approved, rejected, mock sent
- Counts by objective: appreciation, reward, re-engagement, payment reminder
- Counts by segment: consistent, loyalty candidate, declining activity, dormant, payment reminder
- Top block reasons (finding codes), for example `CONSENT_REQUIRED`, `BILLING_DISPUTED`, `MISSING_EVIDENCE`
- AI used versus not needed (`model_version` is `not_invoked` for drafts blocked before the AI step)
- Average and maximum generation time, measured in the browser
- Approval rate, mock-sent count, and edits per draft (`revision − 1`)
- Errors seen this session, by code (429, 503, 504 and so on)

A "Run demo scenarios" button may create drafts for C001, C004, C008, C011, C014, C007, C019, C023 and C036 one after another (9 generations, under the 20-per-minute limit). Each one is a real draft in the database.

Label every statistic "This session". Do not show the dataset's expected labels as results; the AI developer's `EVALUATION.md` covers that comparison.

**Proposed (backend, not built):** a read-only statistics endpoint over all stored drafts, and the v1.1 `/details` endpoint. Show these sections only when `/health` reports a newer version.

### Tab 4: Audit and outbox (Proposed, v1.1)

Per draft: the timeline of events (created, edited, approved, rejected, mock-sent) with actor, time and request ID, offer eligibility reasons, and the mock outbox entry. This needs `GET /api/v1/drafts/{id}/details` from `PROPOSAL_v1.1.0.md`. It is not approved yet, so keep it hidden on `1.0.0`. The mock backend can show it.

### Header: system status

Call `GET /health` (no token) on load and every 30 seconds. Show "Backend online · contract 1.0.0", or "Backend offline". `/health` does not cover the AI service; a 503 on draft creation means the AI side is unavailable.

## 3. API reference (1.0.0)

Every request: header `X-Request-ID` (your own ID; letters, digits, `_` or `-`, at most 64 characters) and `Authorization: Bearer <reviewer token>` (except `/health`). Every POST also needs `Content-Type: application/json` and an `Idempotency-Key`.

| Method and path | Body | Success |
|---|---|---|
| `GET /health` | none | 200 `{"status":"ok","service":"backend","contract_version":"1.0.0"}` |
| `GET /api/v1/customers/{customer_id}/context` | none | 200 `Context` |
| `POST /api/v1/drafts` | `{"customer_id":"C001","channel":"email","locale":"en-IN"}` | 201 `Draft` (200 when the same key is replayed) |
| `GET /api/v1/drafts/{draft_id}` | none | 200 `Draft` |
| `POST /api/v1/drafts/{draft_id}/review` | `ReviewRequest` | 200 `Draft` |

No query parameters are accepted anywhere; `?x=1` returns 422.

Review bodies (all five fields are always required):

```json
{"expected_revision":1,"decision":"approve","edited_message":null,"feedback":null,"delivery":"draft_only"}
{"expected_revision":1,"decision":"approve","edited_message":null,"feedback":null,"delivery":"mock_email"}
{"expected_revision":1,"decision":"reject","edited_message":null,"feedback":"Wrong tone","delivery":"draft_only"}
{"expected_revision":1,"decision":"edit","edited_message":{"subject":"...","body":"..."},"feedback":null,"delivery":"draft_only"}
```

Rules: edit and reject always use `draft_only`; approve and reject always send `edited_message: null`; `expected_revision` is the revision currently on screen. Each successful review adds 1 to the revision.

**Edits:** reviewers can change the subject and body freely, and the backend always saves the edit as a new revision (200). Text issues come back as **warnings** in `validation.findings` (`severity: "warning"`): for example a removed disclaimer or support text, a changed name, offer detail, amount or due date, a new number, a link, email or phone number, a blocked phrase, another offer, or a promotion in a payment reminder. Show them to the reviewer; they do not stop approval. Customer-level checks (consent, billing, contact limits) are still **blocks**: if the customer is blocked, the edited draft stays `blocked` and cannot be approved, only edited or rejected. An approved or mock-sent draft keeps the edited text.

Main `Draft` fields: `draft_id`, `customer_id`, `revision`, `status`, `segments[]` (code, reason_codes, confidence, evidence), `strategy` (objective, tone, template_id, reminder_stage, or null), `selected_offer_id`, `message` (subject, body, or null), `evidence[]`, `validation` (passed, findings[], checked_at), `versions` (policy, template, prompt, model, data), `campaign_key`, `created_at`, `updated_at`, `approved_by`, `approved_at`, `send_status` (`not_sent`, `draft_only`, `mock_sent`), `delivery_id`, `feedback`, `request_id`. Money is in paise (integer); show it as `INR 750.00`. Null means unknown; never show it as 0 or "yes".

Generate TypeScript types from `contracts/schema.json` instead of writing them by hand.

## 4. Errors and what the UI should do

Every error body is `{"error":{"code","message","request_id","retryable","details[]"}}`. Show the message and the request ID.

| HTTP / code | Meaning | UI action |
|---|---|---|
| 401 `UNAUTHORIZED` | Missing, wrong or expired token | Ask for the token again |
| 404 `NOT_FOUND` | Unknown draft or customer, or not in this token's list | "Not found" |
| 409 `VERSION_CONFLICT` | Someone changed the draft, or customer data changed | Reload the draft; the reviewer must look again |
| 409 `INVALID_TRANSITION` | Draft is already final | Reload; offer "Generate a new draft" |
| 409 `IDEMPOTENCY_CONFLICT` | Same key, different body | Bug: use a new key for each new action |
| 422 `INVALID_REQUEST` | Bad body or header | Bug: check the request |
| 422 `REVIEW_BLOCKED` | Edit or approval failed the safety checks now | Show `details[]`; nothing was saved or sent |
| 429 `RATE_LIMITED` | Too many requests for this token | Wait `Retry-After` seconds, then allow retry |
| 503 `SERVICE_UNAVAILABLE` | AI service down or its answer rejected | "Try again"; reuse the same key |
| 504 `AI_TIMEOUT` | AI took too long | "Try again"; reuse the same key |
| 500 `INTERNAL_ERROR` | Unexpected | Show the request ID for the backend team |

Blocked customers are not errors: draft creation returns 201 with `status: "blocked"`.

## 5. Client rules

- **One request wrapper** for base URL, token, request ID, idempotency key, JSON and errors.
- **Idempotency:** a new user action gets a new key. A network retry of the same action reuses the same key and the same body. Disable the button while a request is in flight.
- **Token:** keep it in memory only (not `localStorage`, not a `VITE_` variable, not in URLs or logs). Each person gets their own reviewer token from Bhargav. Never use `AI_SERVICE_TOKEN` or `BACKEND_TOOL_TOKEN`; they are backend-to-AI secrets.
- **Session storage:** active draft IDs and pending keys only, never customer records.
- **Timeout:** wait up to 40 seconds for draft creation.
- **No direct AI calls:** the browser talks only to the backend.
- **Plain text only:** render the email as text, not HTML.
- **No real sending:** "mock-send" only records an outbox row on the backend.

## 6. Demo customers

| Customer | Expected outcome |
|---|---|
| C001 | Appreciation (consistent payer) |
| C004 | Reward with OFFER100 (loyalty candidate) |
| C008 | Re-engagement (declining activity) |
| C011 | Re-engagement (dormant) |
| C014 | Payment reminder (courteous) |
| C007 | Blocked: no marketing consent |
| C019 | Blocked: billing dispute |
| C023 | Blocked: missing evidence |
| C036 | Blocked: email channel not allowed |

Bills in the dataset were verified at 2026-10-31 04:00 UTC and count as stale after 24 hours. From 1 November 09:30 IST, payment reminders such as C014 come back blocked with `BILLING_UNVERIFIED`. That is correct behaviour, not a bug.

Already happened on 31 October: C001 and C014 were mock-sent at about 14:35 IST, so new drafts for them come back blocked with `DUPLICATE_OUTREACH` for 7 days. For those scenarios use C002 (appreciation) and C015 (payment reminder) instead.

Emails use templates v2 (`templates_v2`) since 15:09 IST: greeting, short paragraphs, amount and due date on separate lines, sign-off, disclaimer at the bottom. Drafts created earlier still carry `templates_v1` and return 409 `VERSION_CONFLICT` on approval; regenerate them.

Mock-sending to a customer records a contact. Later drafts for that customer may then be blocked by the contact-frequency or duplicate rules. Use **Approve draft** (draft only) in rehearsals and keep **Approve and mock-send** for the final demo.

## 7. Checklist before the demo

- [ ] `/health` shows online with contract 1.0.0
- [ ] With a valid token, all nine demo customers give the outcomes in section 6
- [ ] Blocked drafts disable Approve but allow Reject
- [ ] Edit refusal keeps the typed text and shows the reasons
- [ ] 409 reloads the draft; 429 waits for `Retry-After`; 503/504 retry with the same key
- [ ] Approve-and-mock-send shows "Mock sent" only after the response
- [ ] Statistics tab is labelled "This session"
- [ ] Proposed panels (audit, outbox, eligibility) are hidden on contract 1.0.0
