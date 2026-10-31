# CodeVortex AI service contract

Build a Gemini-based orchestration service for the five-hour HCLTech Customer Loyalty and Engagement Assistant. Expose the single internal generation operation below at `http://100.114.163.7:8001`, preferably through a thin FastAPI app. The application backend is FastAPI at `http://100.83.115.82:8000`; the React reviewer UI has no direct AI connection.

## AI responsibilities

Own the Gemini provider adapter, prompt versioning, structured-output parsing, bounded orchestration, ToolClient interface and AI service telemetry. The backend owns authoritative context, deterministic classification/eligibility/billing/consent validation, draft persistence, reviewer permissions and mock delivery. The service orchestrates that flow; it does not independently redefine those rules in prompts. Never return a successful generated response without calling both allowed tools and validating the result.

Receive a scoped AIRequest from the backend. Verify service auth and required delegation header. Call evaluate_customer with the request customer_id/turn_id. If blocked, return the tool's plan and no message. Otherwise build the Gemini instruction using the approved template and minimum required facts. Ask Gemini for exactly Message plus allowlisted evidence, validate its structure locally, call validate_draft, and return AIResponse. The backend rechecks the output; it never trusts an AI-reported pass. Do not expose provider SDK objects, prompts, token secrets, hidden reasoning or inconsistent ad hoc fields in responses.

The approved-template constraint is deliberate: generation is bounded to verified slots and policy-controlled wording. Distinct templates provide distinct tones. Free paraphrasing cannot be safely validated with a substring check in five hours, so it is excluded from v1. Use the supplied canonical templates as the authority, not instructions embedded in customer data. A failed candidate becomes a visible blocked draft, not an invented success. The backend holds policy configuration; the AI service consumes the snapshot without editing it.

## Service implementation and tooling

Use the Google Gemini SDK or equivalent provider client behind GeminiAdapter, an HTTP ToolClient, Pydantic/JSON Schema validation and environment-based secret loading. Select the concrete available Gemini model at setup and record it in configuration and responses; no specific model availability is assumed by this handoff. Keep endpoint code separate from provider code so deterministic fixture tests require no API key or network. Use async calls and propagate cancellation within the shared time budget.

ToolClient has exactly two operations, evaluate_customer and validate_draft, both mapped to POST /internal/v1/tools/execute. It forwards the scoped delegation token and its own backend tool credential; neither credential belongs in the prompt or response body. It must not accept model-generated URLs or arbitrary function names. Model-requested unrecognized tools are rejected locally; never add tools dynamically. No web search, SQL tool, arbitrary code execution, email tool, billing tool or consent mutation tool is required.

For tool auth/schema/infrastructure errors, propagate a redacted Error using the matching status. For policy failures return AIResponse generation_status=blocked. For model unavailability/parse failure after the permitted repair attempt, return AIResponse generation_status=unavailable with message=null. A full service timeout returns 504 AI_TIMEOUT. On unavailable or blocked output do not include unvalidated invented evidence. model_version=not_invoked when no provider call occurred; otherwise use actual provider/configured identity.

## Independent development and testing

Mock the ToolClient using the complete shared Context, Policy and tool result shapes. Mock GeminiAdapter with one exact approved-template candidate and schema-invalid, unsupported-claim and failure candidates. The mock tool must enforce the same plan IDs and validation rules as backend; AI tests must not duplicate business rule implementations as their authority. Switch to the backend gateway by base URL and adapter configuration; request/response JSON must remain unchanged.

Test loyalty/consistent/declining/dormant/overdue scenarios, blocked consent, unknown or disputed billing, unsupported amounts, expired offer fallback, protected-attribute instructions, unknown tools, mismatched customer/turn IDs, budget exhaustion and model parse failures. Assert no Gemini call for preblocked plans, at most two tool calls per normal turn, at most one provider repair attempt, no send side effects and stable output schemas. Live smoke tests must be separate from fixture CI and labelled with actual model identity and run time.

## Handoff from the AI team

Provide the `feat/ai-service` PR, startup/environment example, request/response models, versioned prompt, GeminiAdapter/ToolClient interfaces, validated fixtures and concise evaluation results. Record grounding and policy failures rather than masking them. Provide a short limitations note covering synthetic data, deterministic rules, template-limited text and model availability. Do not implement delivery, customer writes, financial actions or a separate frontend API. The branch is proposed because the remote repository is empty at handoff.

<!-- BEGIN SHARED FROZEN CONTRACT -->
## Shared contract version 1.0.0

This section is identical in both deliverables and is normative. Freeze the paths, field names, enum values, units, status transitions and error semantics below for the five-hour build. This is a concrete implementation specification selected for this handoff, not a claim that unavailable earlier assistant replies contained these exact choices. A breaking change needs both consumers updated together and a new contract version; do not silently change one file. Fix documentation errors in both copies. Configuration changes do not change the wire contract.

### Confirmed inputs and explicit implementation choices

The source is HCLTech's **Customer Loyalty and Engagement Assistant**, Usecase5 participant brief supplied as `CustomerEngagementAssistant_AIEngineer_Usecase5.docx`. FR-01 through FR-10 require permitted customer context, explainable segments, policy strategies, grounded email drafts, deterministic eligibility/billing, safety checks, reviewer edits/approval/rejection, audit, and controlled delivery. The brief excludes unsupervised bulk outreach and autonomous financial action and prohibits protected characteristics or proxy attributes in decision rules.

Confirmed by the user: FastAPI backend, React frontend, Gemini AI orchestrator, separate frontend and AI handoffs, few endpoints, parallel development, the three Tailscale IPs below, and [bhargav6324/CodeVortex](https://github.com/bhargav6324/CodeVortex). The linked “Parallel Architecture Plan” chat exposed user requests but assistant answers were unresolved content references. No extra historical decisions are asserted. The five-hour limit comes from the current task. Ports, paths, schema, policy defaults, auth approach, directory layout and branch names below are implementation choices frozen by this handoff. GitHub returned an empty repository and an empty branch list on 31 October 2026; branches below are planned, not verified existing branches. No repository writes or remote branch creation were performed.

### Hosts and configuration

| Component | Tailscale address | Frozen development URL | Owner |
|---|---|---|---|
| React frontend | `100.117.73.55` | `http://100.117.73.55:5173` | Frontend team |
| FastAPI backend | `100.83.115.82` | `http://100.83.115.82:8000` | Backend team |
| Gemini orchestrator service | `100.114.163.7` | `http://100.114.163.7:8001` | AI team |

These are supplied addresses, not connectivity-tested hosts. Bind development servers to the Tailscale interface or `0.0.0.0` with host firewall restrictions. Keep HTTP inside the private Tailscale development network with synthetic data. Internet deployment requires HTTPS; an HTTPS page must use an HTTPS backend to avoid mixed-content blocking. Tailscale membership alone is not application authorization.

```dotenv
# Frontend public configuration; never put tokens or Gemini keys here
VITE_API_BASE_URL=http://100.83.115.82:8000
VITE_USE_MOCKS=true
# Backend only
AI_SERVICE_BASE_URL=http://100.114.163.7:8001
CORS_ORIGINS=http://100.117.73.55:5173,http://localhost:5173
DELIVERY_MODE=mock_email
# AI service only
BACKEND_TOOL_BASE_URL=http://100.83.115.82:8000
GEMINI_MODEL=<select an available Gemini model and record its actual version>
GEMINI_API_KEY=<server secret>
# Server secrets provisioned separately, never committed
AI_SERVICE_TOKEN=<backend to AI bearer credential>
BACKEND_TOOL_TOKEN=<AI to backend bearer credential>
DELEGATION_SIGNING_SECRET=<backend only signing secret>
```

Use different service credentials for each direction. AI receives an opaque, signed, short-lived delegation token per turn; it cannot mint one. Backend verifies it without sharing its signing secret. Reviewer bearer tokens are provisioned out of band for the demo; there is no login API in v1. Use an input/session memory for the token, not a committed Vite variable or persistent browser storage.

### REST surface

All request and response bodies use UTF-8 `application/json`; there are no multipart uploads, SSE, WebSockets, pagination or real email endpoints in v1. Schema names refer to the full JSON Schema registry below. A path placeholder is one ID matching the schema ID pattern. No query parameters are accepted.

| Caller → owner | Method and exact path | Request body | Success body | Success status |
|---|---|---|---|---|
| Monitor → backend | `GET /health` | none | `Health` | 200 |
| React → backend | `GET /api/v1/customers/{customer_id}/context` | none | `Context` | 200 |
| React → backend | `POST /api/v1/drafts` | `DraftRequest` | `Draft` | 201 new; 200 replay |
| React → backend | `GET /api/v1/drafts/{draft_id}` | none | `Draft` | 200 |
| React → backend | `POST /api/v1/drafts/{draft_id}/review` | `ReviewRequest` | `Draft` | 200 |
| Backend → AI | `POST /internal/v1/generate` | `AIRequest` | `AIResponse` | 200 |
| AI → backend | `POST /internal/v1/tools/execute` | `ToolRequest` | `ToolResponse` | 200 |

There are four authenticated browser operations plus liveness and two internal operations. The two tool names are dispatched behind one internal endpoint; they are not additional REST paths. React never calls the AI service, Gemini or the internal tool endpoint.

Public operations require `Authorization: Bearer <reviewer-token>`; backend maps the token to actor ID, reviewer role and allowed customers. `/health` is unauthenticated and checks only backend liveness. Internal generate requires the AI service bearer credential plus `X-Delegation-Token`; internal tools require the backend tool bearer credential plus that same delegation token. Tokens bind customer ID, turn ID, data/policy snapshot versions, audience and expiry (60 seconds). Service credentials do not authorize an arbitrary customer. Reject mismatched body IDs or snapshots with 403.

Every request may supply `X-Request-ID` matching ID; otherwise the receiving service generates one. Propagate it and echo it on every response, including errors; `Draft.request_id` identifies the original generation request. Responses also carry `X-Contract-Version: 1.0.0` and `Cache-Control: no-store`. Browser CORS exposes `X-Request-ID`, `X-Contract-Version` and `Retry-After`; allows GET, POST, OPTIONS and Authorization, Content-Type, Idempotency-Key, X-Request-ID headers. Allow only the two configured frontend origins. Internal credentials and delegation headers are never CORS-accessible. Disable public internal routes at the proxy and enforce service auth at the application too.

Require `Idempotency-Key` on public POSTs, an opaque ID matching the ID pattern. Scope it to actor, method and exact path and retain the request hash and final status/body for 24 hours in backend storage. The same key and same body replays the stored response (draft creation replays as 200); a changed body is 409 `IDEMPOTENCY_CONFLICT`. Reserve keys transactionally before work; an identical concurrent in-flight request returns 409 `VERSION_CONFLICT` with retryable true and `Retry-After: 1`. Transport failures may be retried with the same key; persist the outcome before replying. Transient 5xx outcomes release the reservation only when no draft or review transaction committed. Successful blocked drafts are replayable resources. Internal generation is read-only and keyed by `turn_id`; it never sends or writes business state.

All non-success responses use `Error`, including FastAPI validation errors; override its default 422 handler. Missing/unknown JSON fields, malformed JSON, invalid enum, missing idempotency key or bad header format return 422. All schema properties are required; use explicit null only where allowed. IDs are opaque strings, timestamps RFC3339 UTC `Z`, dates `YYYY-MM-DD`, currency INR and money nonnegative integer paise. Confidence is rule confidence in [0,1], not an LLM probability. Empty arrays mean no records; null means unknown/not applicable and must never be converted to zero or consent.

| HTTP | Error code | Meaning and recovery |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing, expired or invalid credential; reacquire credential |
| 403 | `FORBIDDEN` | Role/customer/delegation scope denied; do not retry |
| 404 | `NOT_FOUND` | Missing resource or customer outside visibility; do not leak existence |
| 409 | `IDEMPOTENCY_CONFLICT` | Key reused with a changed body; fix client action |
| 409 | `VERSION_CONFLICT` | Stale revision or in-flight operation; reload; in-flight can retry |
| 409 | `INVALID_TRANSITION` | State forbids the requested review |
| 422 | `INVALID_REQUEST` | Invalid JSON, schema, header or semantic request combination |
| 422 | `REVIEW_BLOCKED` | Current deterministic checks failed on edit/approval; nothing sent |
| 429 | `RATE_LIMITED` | Respect `Retry-After` seconds |
| 504 | `AI_TIMEOUT` | Generation exceeded time budget; retry with the same key |
| 503 | `SERVICE_UNAVAILABLE` | AI/tool dependency unavailable; retry only if retryable |
| 500 | `INTERNAL_ERROR` | Redacted unexpected failure; reference request ID |

Business refusal during generation returns a persisted 201 `Draft` with status `blocked`, nonempty block findings and no delivery. This lets the UI review safety failures. Authentication, malformed requests and infrastructure failures use HTTP errors instead. An AI `blocked` result maps to a blocked draft; `unavailable` maps to 503 and creates no draft. Policy failure in tool execution returns 200 with `Validation.passed=false`; transport/auth/schema failures use `Error`.

### Draft workflow and human approval

Backend assembles a versioned context and policy snapshot and calls AI. AI evaluates the customer through the deterministic tool, uses Gemini to prepare the allowed structured output, then validates the candidate through the second tool. Backend independently revalidates every AI result before persisting it. A successful message has `ready_for_review`; a refusal has `blocked`, `message=null` or a non-deliverable candidate, and one or more block findings. A missing strategy is null. `validation.passed` is true exactly when there are no block findings. Human approval is enforced by state, not by a blocking validation finding on every unreviewed draft; `HUMAN_APPROVAL_REQUIRED` is used when an unapproved delivery is attempted.

`ReviewRequest` combinations are strict: `edit` requires `edited_message` and `delivery=draft_only`; `approve` and `reject` require `edited_message=null`; `reject` requires `delivery=draft_only`. Feedback is optional via null. Reject must remain possible for blocked drafts; it needs authorization and revision checks but no content/consent validation. Every committed review increments revision by one and updates timestamp, feedback and audit. Reads do not change revision. Editing or approving a blocked message cannot bypass its checks.

| Current state | Action | Result |
|---|---|---|
| ready_for_review or blocked | edit | Validate proposed text; on pass save new revision as ready_for_review; on failure 422, no draft mutation |
| ready_for_review | approve + draft_only | Revalidate current evidence/consent/eligibility/content; persist approved, send_status=draft_only |
| ready_for_review | approve + mock_email | Same checks; atomically insert one mock delivery and persist mock_sent, send_status=mock_sent |
| ready_for_review or blocked | reject | Persist rejected, send_status=not_sent |
| blocked | approve | 422 REVIEW_BLOCKED |
| approved, rejected or mock_sent | any new review | 409 INVALID_TRANSITION; idempotent replay still allowed |

The mock email adapter writes a local outbox row in the same database transaction as approval; it performs no SMTP/real email call. Only `mock_sent` has a delivery_id. Approved states set `approved_by` from the authenticated actor and `approved_at` from server time; all other states have both null. `approved` and `mock_sent` are terminal. There is no separate send API; a draft-only approval cannot later be sent in v1. A new draft and approval are needed, subject to current contact rules. Approval never redeems offers, changes plans, charges, refunds, pays bills or changes consent.

`expected_revision` is mandatory; compare and commit under a transaction/row lock. On approval, re-read current customer, offers, policy, consent, bills and contacts. If the stored `data_version`, `policy_version` or `template_version` differs, return 409 VERSION_CONFLICT and require regeneration; never silently approve stale terms. Even if versions match, recompute expiry and frequency at server time. Revisions and idempotency prevent double-click sends; a unique mock-outbox key on draft_id prevents concurrent duplicate delivery. Check contacts and insert outbox under the same customer lock to prevent concurrent drafts bypassing limits.

### Deterministic classification and policy

The following values are synthetic demo assumptions, configurable through `Policy`, not HCLTech-supplied business thresholds. Never use protected attributes, demographic proxies, free-text sentiment or inferred financial vulnerability in classification, eligibility or reminder severity. Use only the permitted fields in Context.

1. `consistent`: timely_payments_last_3=3 → TIMELY_PAYMENT. Unknown payments do not qualify.
2. `loyalty_candidate`: loyalty_points>=1000 AND tenure_months>=12 → LOYALTY_THRESHOLD.
3. `declining_activity`: previous_30d>0 AND current_30d/previous_30d<=0.5 → ACTIVITY_DECLINED. Unknown counts or previous=0 do not qualify.
4. `dormant`: current_30d=0 AND last_activity_at is known and at least 30 elapsed days old → NO_RECENT_ACTIVITY. A null last activity is unknown, not dormant.
5. `payment_reminder`: verified status=overdue, amount_due>0, due_date earlier than current UTC date and no dispute → VERIFIED_OVERDUE.

Return all matching segments in this stable order: payment_reminder, dormant, declining_activity, loyalty_candidate, consistent. Include exact field/value evidence and confidence=1 for each rule match. Unknown required evidence produces a block rather than guessing. No matched segment produces MISSING_EVIDENCE and strategy=null. Label comparison uses sets; order remains stable for display.

Strategy precedence: payment_reminder → payment_reminder; else dormant or declining_activity → reengagement; else loyalty_candidate with an eligible offer → reward; else loyalty_candidate or consistent → appreciation. Reward/appreciation tone is warm; reengagement encouraging. Bill reminders are courteous for 1–14 overdue days and firm_respectful from day 15. Days use UTC calendar dates. A firm reminder is allowed only if an earlier mock contact with campaign_key `bill_<bill_id>_courteous` exists; otherwise use courteous. Never threaten legal action, disconnection, penalties or urgency unsupported by policy. A disputed bill, unknown/unverified bill or contradictory bill status blocks all outreach in this demo and creates a support-path finding. Any open dispute also blocks outreach to avoid cross-selling during a dispute. Billing evidence older than 24 hours or future timestamps are invalid. Missing activity may leave activity segments unassigned if sufficient other evidence supports the chosen objective; the selected objective's required facts must always be present.

Offer eligibility is deterministic: active UTC validity window (`valid_from <= now < expires_at`), correct channel, approved plan allowlist, minimum loyalty/tenure, exact offer ID/terms/value, and marketing opt-in when required. All reward and reengagement outreach requires marketing opt-in even if the individual offer flag is false. Payment reminders never contain promotions. If no eligible offer exists, loyalty candidates receive appreciation without an offer; reengagement uses the no-offer template in v1. If several offers qualify, choose highest value then lexicographically smallest offer_id. No implied redemption: approval delivers a mock invitation only. Copy offer terms and expiry exactly; rendering expiry as its UTC date is allowed.

Every email requires email_allowed. Appreciation/reward/reengagement additionally require marketing_opt_in; payment reminders require service_email_allowed. A missing consent record denies outreach. These consent fields are authoritative; the model and reviewer cannot grant consent in a draft. Dataset loaders reject incomplete consent records; a backend missing consent row assembles false permissions with a block finding. Do not include raw email addresses in AI requests; mock recipient routing remains server-side.

Contact limits: fewer than 2 mock-sent emails in the preceding 7 elapsed days and no same campaign_key within 7 days. Count mock_sent contacts only, including at the exact window lower bound; use UTC. Campaign keys: `reward_<offer_id>_<terms_version>`, `appreciation_<policy_version>`, `reengagement_<policy_version>`, or `bill_<bill_id>_<reminder_stage>`. Block exact repeat customer+subject+body hashes for 7 days regardless of campaign. Audit/outbox stores that hash; seed contacts lack bodies so tests for text duplicates must seed outbox hashes too. Draft-only approvals do not count as delivered contacts.

Grounding is fail closed. The backend renders a canonical subject/body from the selected approved template and the allowlisted placeholders below, normalizing only CRLF to LF and trimming outer whitespace. Gemini output and reviewer edits must equal this canonical rendering in v1. This deliberately limits wording variety to the configured approved templates; arbitrary paraphrases or edits return UNSUPPORTED_CLAIM/POLICY_MISMATCH. A reviewer may correct formatting normalized by this rule; substantive wording changes require a policy/template update and regeneration. Do not claim that string scanning alone verifies free-form factual text. This constrained check guarantees no invented amount, date, benefit or promise within the five-hour scope while still exercising Gemini structured generation and the edit workflow.

Allowed template variables: display_name, tenure_months, offer_title, offer_terms, offer_expiry_date, amount_due, due_date, required_disclaimer, support_text. No expressions, arbitrary attributes, URL fetches or nested template evaluation. INR money renders `INR <amount_minor/100>` with exactly two decimals for billing; offer_terms remains the approved literal. Template rendering substitutes once and never interprets substituted text. Reject unrecognized or unresolved placeholders. Validate policy templates and campaign copy before loading, and check blocked phrases case-insensitively after rendering. Disallow unapproved links, phone numbers, payment instructions and personal identifiers beyond display_name. Do not send full bill/account numbers, addresses or credentials to Gemini. Evidence must refer to an allowlisted field and exactly match the supplied snapshot; it is factual evidence, never hidden reasoning.

### Gemini orchestration and backend tools

`AIRequest.context` is the permitted snapshot; `policy` is approved immutable configuration for that turn. `as_of` must equal context.as_of and the delegation snapshot. The AI service cannot accept a browser-selected policy or fabricated profile. It calls `evaluate_customer` once before generation, receives a `Plan`, and returns that exact plan. If the plan is blocked, skip Gemini and return generation_status=blocked, message=null, model_version=`not_invoked`. Otherwise invoke Gemini with a system instruction separating data from instructions, the approved strategy/template and minimum required facts; request structured Message and evidence only. Use low temperature, bounded output and a model name from GEMINI_MODEL; record the actual provider/model version returned, or the exact configured identifier if no version is returned. Do not invent a model version.

Then call `validate_draft` once with the generated message and the selected offer/template IDs. The tool retrieves the stored turn snapshot, verifies the IDs equal its deterministic plan and validates canonical text. For a failed validation return generation_status=blocked and replace plan.validation with that result; all other plan fields remain unchanged. For a pass use the latest tool validation as plan.validation. AIResponse generated requires a non-null message, non-null strategy and passing plan.validation; blocked requires failing plan.validation and at least one block finding; unavailable always has message=null. Backend rejects inconsistent output as SERVICE_UNAVAILABLE instead of persisting it. For a pass return generated. If Gemini is unavailable or its output fails schema parsing after at most one repair attempt, return unavailable, message=null; backend maps it to 503. Do not fabricate a model response or silently label a template fallback as Gemini generation.

The tool gateway supports exactly these closed argument objects (no arbitrary SQL, filesystem, URLs or write actions):

```json
{
  "tool": "evaluate_customer",
  "turn_id": "TURN001",
  "arguments": {
    "customer_id": "CUST001"
  }
}
```
```json
{
  "tool": "validate_draft",
  "turn_id": "TURN001",
  "arguments": {
    "customer_id": "CUST001",
    "message": {
      "subject": "Thank you for your loyalty",
      "body": "Hello Asha,\nThank you for being with us for 18 months. You are eligible for our Loyalty reward: INR 100 reward voucher. Valid for one redemption. No cash alternative. Offer expires 2026-11-30.\nTerms apply. This is a draft for human review.\nContact support for questions or billing disputes."
    },
    "selected_offer_id": "OFFER100",
    "template_id": "reward_v1"
  }
}
```
`evaluate_customer` returns EvaluateToolResponse, with rule-based segments, strategy, selected offer, all offer eligibility results and plan validation. `validate_draft` returns ValidateToolResponse. Both require customer_id to equal the stored scoped turn. The gateway uses the backend's stored snapshot, never AI-supplied evidence as its source of truth. Tools do not mutate customers, consent, bills, offers, drafts, contacts or outbox. Backend performs one final independent validation before persistence and a fresh validation at approval.

Timeouts: browser 40 seconds, backend generation budget 30 seconds, backend→AI 25 seconds total, AI entire workflow 22 seconds total including tools/repair, each tool call 3 seconds, Gemini attempts together at most 15 seconds within the overall budget. Maximum two tool calls and two Gemini attempts per turn; no recursive agent loop. Stop when the remaining budget is insufficient. No automatic retry for public mutations except identical idempotency keys. Apply configurable rate limits: demo default 20 generation requests/minute/actor, 60 reads or reviews/minute/actor; 429 includes Retry-After. A timeout or failed review never causes an email to be sent.

### JSON Schema registry

Draft 2020-12 registry. Each top-level API body is validated using `{ "$ref": "urn:codevortex:loyalty:1.0.0#/$defs/<SchemaName>" }` after registering this document. The compact formatting puts each definition on one line; every object is closed and lists required fields. Apply the cross-field/business rules above in addition to schema validation. Generate matching Pydantic and TypeScript definitions from these schemas; use FastAPI OpenAPI for discovery only after checking it matches this frozen specification.

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema",
 "$id":"urn:codevortex:loyalty:1.0.0",
 "$defs":{
  "Money":{"type":"object","additionalProperties":false,"required":["amount_minor","currency"],"properties":{"amount_minor":{"type":"integer","minimum":0},"currency":{"type":"string","enum":["INR"]}}},
  "Message":{"type":"object","additionalProperties":false,"required":["subject","body"],"properties":{"subject":{"type":"string","minLength":1,"maxLength":160},"body":{"type":"string","minLength":1,"maxLength":5000}}},
  "Evidence":{"type":"object","additionalProperties":false,"required":["field","value"],"properties":{"field":{"type":"string","minLength":1,"maxLength":200},"value":{"type":["string","number","boolean","null"]}}},
  "Segment":{"type":"object","additionalProperties":false,"required":["code","reason_codes","confidence","evidence"],"properties":{"code":{"type":"string","enum":["consistent","loyalty_candidate","declining_activity","dormant","payment_reminder"]},"reason_codes":{"type":"array","items":{"type":"string","enum":["TIMELY_PAYMENT","LOYALTY_THRESHOLD","ACTIVITY_DECLINED","NO_RECENT_ACTIVITY","VERIFIED_OVERDUE"]},"maxItems":5},"confidence":{"type":"number","minimum":0,"maximum":1},"evidence":{"type":"array","items":{"$ref":"#/$defs/Evidence"},"maxItems":20}}},
  "Strategy":{"type":"object","additionalProperties":false,"required":["objective","tone","template_id","reminder_stage"],"properties":{"objective":{"type":"string","enum":["appreciation","reward","reengagement","payment_reminder"]},"tone":{"type":"string","enum":["warm","encouraging","courteous","firm_respectful"]},"template_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"reminder_stage":{"type":"string","enum":["none","courteous","firm"]}}},
  "Finding":{"type":"object","additionalProperties":false,"required":["code","severity","field","message"],"properties":{"code":{"type":"string","enum":["MISSING_EVIDENCE","CONTRADICTORY_DATA","CONSENT_REQUIRED","CHANNEL_BLOCKED","CONTACT_FREQUENCY","DUPLICATE_OUTREACH","OFFER_INELIGIBLE","OFFER_EXPIRED","OFFER_TERMS_MISMATCH","BILLING_UNVERIFIED","BILLING_DISPUTED","UNSUPPORTED_CLAIM","PROHIBITED_LANGUAGE","SENSITIVE_DATA","POLICY_MISMATCH","MODEL_UNAVAILABLE","HUMAN_APPROVAL_REQUIRED"]},"severity":{"type":"string","enum":["block","warning"]},"field":{"anyOf":[{"type":"string","minLength":1,"maxLength":200},{"type":"null"}]},"message":{"type":"string","minLength":1,"maxLength":500}}},
  "Validation":{"type":"object","additionalProperties":false,"required":["passed","findings","checked_at","validator_version"],"properties":{"passed":{"type":"boolean"},"findings":{"type":"array","items":{"$ref":"#/$defs/Finding"},"maxItems":30},"checked_at":{"type":"string","format":"date-time"},"validator_version":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"}}},
  "Offer":{"type":"object","additionalProperties":false,"required":["offer_id","title","terms","terms_version","value","valid_from","expires_at","channel","min_loyalty_points","min_tenure_months","allowed_plans","requires_marketing_consent"],"properties":{"offer_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"title":{"type":"string","minLength":1,"maxLength":160},"terms":{"type":"string","minLength":1,"maxLength":2000},"terms_version":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"value":{"$ref":"#/$defs/Money"},"valid_from":{"type":"string","format":"date-time"},"expires_at":{"type":"string","format":"date-time"},"channel":{"type":"string","enum":["email"]},"min_loyalty_points":{"type":"integer","minimum":0},"min_tenure_months":{"type":"integer","minimum":0},"allowed_plans":{"type":"array","items":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"maxItems":20},"requires_marketing_consent":{"type":"boolean"}}},
  "Customer":{"type":"object","additionalProperties":false,"required":["customer_id","display_name","active_plan","tenure_months","loyalty_points","activity_current_30d","activity_previous_30d","last_activity_at","timely_payments_last_3"],"properties":{"customer_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"display_name":{"type":"string","minLength":1,"maxLength":100},"active_plan":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"tenure_months":{"type":"integer","minimum":0},"loyalty_points":{"type":"integer","minimum":0},"activity_current_30d":{"anyOf":[{"type":"integer","minimum":0},{"type":"null"}]},"activity_previous_30d":{"anyOf":[{"type":"integer","minimum":0},{"type":"null"}]},"last_activity_at":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"timely_payments_last_3":{"anyOf":[{"type":"integer","minimum":0,"maximum":3},{"type":"null"}]}}},
  "Consent":{"type":"object","additionalProperties":false,"required":["email_allowed","marketing_opt_in","service_email_allowed","recorded_at","source"],"properties":{"email_allowed":{"type":"boolean"},"marketing_opt_in":{"type":"boolean"},"service_email_allowed":{"type":"boolean"},"recorded_at":{"type":"string","format":"date-time"},"source":{"type":"string","minLength":1,"maxLength":100}}},
  "Billing":{"type":"object","additionalProperties":false,"required":["bill_id","status","amount_due","due_date","verified_at","dispute_open","support_text"],"properties":{"bill_id":{"anyOf":[{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},{"type":"null"}]},"status":{"type":"string","enum":["paid","current","overdue","disputed","unknown"]},"amount_due":{"anyOf":[{"$ref":"#/$defs/Money"},{"type":"null"}]},"due_date":{"anyOf":[{"type":"string","format":"date"},{"type":"null"}]},"verified_at":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"dispute_open":{"type":"boolean"},"support_text":{"type":"string","minLength":1,"maxLength":300}}},
  "Contact":{"type":"object","additionalProperties":false,"required":["contact_id","customer_id","campaign_key","channel","sent_at","delivery"],"properties":{"contact_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"customer_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"campaign_key":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"channel":{"type":"string","enum":["email"]},"sent_at":{"type":"string","format":"date-time"},"delivery":{"type":"string","enum":["mock_email"]}}},
  "Context":{"type":"object","additionalProperties":false,"required":["customer","consent","billing","contacts","offers","data_version","as_of"],"properties":{"customer":{"$ref":"#/$defs/Customer"},"consent":{"$ref":"#/$defs/Consent"},"billing":{"$ref":"#/$defs/Billing"},"contacts":{"type":"array","items":{"$ref":"#/$defs/Contact"},"maxItems":100},"offers":{"type":"array","items":{"$ref":"#/$defs/Offer"},"maxItems":20},"data_version":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"as_of":{"type":"string","format":"date-time"}}},
  "Policy":{"type":"object","additionalProperties":false,"required":["policy_version","template_version","loyalty_points_threshold","loyalty_tenure_months","decline_ratio","dormant_days","firm_after_days","max_contacts_7d","dedupe_days","billing_max_age_hours","required_disclaimer","blocked_phrases","templates"],"properties":{"policy_version":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"template_version":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"loyalty_points_threshold":{"type":"integer","minimum":0},"loyalty_tenure_months":{"type":"integer","minimum":0},"decline_ratio":{"type":"number","minimum":0,"maximum":1},"dormant_days":{"type":"integer","minimum":0},"firm_after_days":{"type":"integer","minimum":0},"max_contacts_7d":{"type":"integer","minimum":0},"dedupe_days":{"type":"integer","minimum":0},"billing_max_age_hours":{"type":"integer","minimum":0},"required_disclaimer":{"type":"string","minLength":1,"maxLength":500},"blocked_phrases":{"type":"array","items":{"type":"string","minLength":1,"maxLength":100},"maxItems":100},"templates":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["template_id","objective","tone","subject","body"],"properties":{"template_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"objective":{"type":"string","enum":["appreciation","reward","reengagement","payment_reminder"]},"tone":{"type":"string","enum":["warm","encouraging","courteous","firm_respectful"]},"subject":{"type":"string","minLength":1,"maxLength":160},"body":{"type":"string","minLength":1,"maxLength":5000}}},"maxItems":10}}},
  "Eligibility":{"type":"object","additionalProperties":false,"required":["offer_id","eligible","reason_codes"],"properties":{"offer_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"eligible":{"type":"boolean"},"reason_codes":{"type":"array","items":{"type":"string","enum":["ELIGIBLE","NO_MARKETING_CONSENT","PLAN_NOT_ALLOWED","LOW_LOYALTY","LOW_TENURE","OFFER_NOT_ACTIVE","BILLING_PRIORITY"]},"maxItems":10}}},
  "Plan":{"type":"object","additionalProperties":false,"required":["segments","strategy","selected_offer_id","eligibility","validation","campaign_key"],"properties":{"segments":{"type":"array","items":{"$ref":"#/$defs/Segment"},"maxItems":5},"strategy":{"anyOf":[{"$ref":"#/$defs/Strategy"},{"type":"null"}]},"selected_offer_id":{"anyOf":[{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},{"type":"null"}]},"eligibility":{"type":"array","items":{"$ref":"#/$defs/Eligibility"},"maxItems":20},"validation":{"$ref":"#/$defs/Validation"},"campaign_key":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"}}},
  "Versions":{"type":"object","additionalProperties":false,"required":["policy_version","template_version","prompt_version","model_version","data_version"],"properties":{"policy_version":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"template_version":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"prompt_version":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"model_version":{"type":"string","minLength":1,"maxLength":200},"data_version":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"}}},
  "DraftRequest":{"type":"object","additionalProperties":false,"required":["customer_id","channel","locale"],"properties":{"customer_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"channel":{"type":"string","enum":["email"]},"locale":{"type":"string","enum":["en-IN"]}}},
  "Draft":{"type":"object","additionalProperties":false,"required":["draft_id","customer_id","revision","status","segments","strategy","selected_offer_id","message","evidence","validation","versions","campaign_key","created_at","updated_at","approved_by","approved_at","send_status","delivery_id","feedback","request_id"],"properties":{"draft_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"customer_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"revision":{"type":"integer","minimum":1},"status":{"type":"string","enum":["ready_for_review","blocked","approved","rejected","mock_sent"]},"segments":{"type":"array","items":{"$ref":"#/$defs/Segment"},"maxItems":5},"strategy":{"anyOf":[{"$ref":"#/$defs/Strategy"},{"type":"null"}]},"selected_offer_id":{"anyOf":[{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},{"type":"null"}]},"message":{"anyOf":[{"$ref":"#/$defs/Message"},{"type":"null"}]},"evidence":{"type":"array","items":{"$ref":"#/$defs/Evidence"},"maxItems":40},"validation":{"$ref":"#/$defs/Validation"},"versions":{"$ref":"#/$defs/Versions"},"campaign_key":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"created_at":{"type":"string","format":"date-time"},"updated_at":{"type":"string","format":"date-time"},"approved_by":{"anyOf":[{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},{"type":"null"}]},"approved_at":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"send_status":{"type":"string","enum":["not_sent","draft_only","mock_sent"]},"delivery_id":{"anyOf":[{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},{"type":"null"}]},"feedback":{"anyOf":[{"type":"string","minLength":1,"maxLength":1000},{"type":"null"}]},"request_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"}}},
  "ReviewRequest":{"type":"object","additionalProperties":false,"required":["expected_revision","decision","edited_message","feedback","delivery"],"properties":{"expected_revision":{"type":"integer","minimum":1},"decision":{"type":"string","enum":["edit","approve","reject"]},"edited_message":{"anyOf":[{"$ref":"#/$defs/Message"},{"type":"null"}]},"feedback":{"anyOf":[{"type":"string","minLength":1,"maxLength":1000},{"type":"null"}]},"delivery":{"type":"string","enum":["draft_only","mock_email"]}}},
  "Health":{"type":"object","additionalProperties":false,"required":["status","service","contract_version"],"properties":{"status":{"type":"string","enum":["ok"]},"service":{"type":"string","enum":["backend"]},"contract_version":{"type":"string","enum":["1.0.0"]}}},
  "AIRequest":{"type":"object","additionalProperties":false,"required":["turn_id","customer_id","as_of","context","policy","locale"],"properties":{"turn_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"customer_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"as_of":{"type":"string","format":"date-time"},"context":{"$ref":"#/$defs/Context"},"policy":{"$ref":"#/$defs/Policy"},"locale":{"type":"string","enum":["en-IN"]}}},
  "AIResponse":{"type":"object","additionalProperties":false,"required":["turn_id","plan","message","evidence","generation_status","prompt_version","model_version"],"properties":{"turn_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"plan":{"$ref":"#/$defs/Plan"},"message":{"anyOf":[{"$ref":"#/$defs/Message"},{"type":"null"}]},"evidence":{"type":"array","items":{"$ref":"#/$defs/Evidence"},"maxItems":40},"generation_status":{"type":"string","enum":["generated","blocked","unavailable"]},"prompt_version":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"model_version":{"type":"string","minLength":1,"maxLength":200}}},
  "EvaluateToolRequest":{"type":"object","additionalProperties":false,"required":["tool","turn_id","arguments"],"properties":{"tool":{"type":"string","enum":["evaluate_customer"]},"turn_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"arguments":{"type":"object","additionalProperties":false,"required":["customer_id"],"properties":{"customer_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"}}}}},
  "ValidateToolRequest":{"type":"object","additionalProperties":false,"required":["tool","turn_id","arguments"],"properties":{"tool":{"type":"string","enum":["validate_draft"]},"turn_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"arguments":{"type":"object","additionalProperties":false,"required":["customer_id","message","selected_offer_id","template_id"],"properties":{"customer_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"message":{"$ref":"#/$defs/Message"},"selected_offer_id":{"anyOf":[{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},{"type":"null"}]},"template_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"}}}}},
  "ToolRequest":{"oneOf":[{"$ref":"#/$defs/EvaluateToolRequest"},{"$ref":"#/$defs/ValidateToolRequest"}]},
  "EvaluateToolResponse":{"type":"object","additionalProperties":false,"required":["tool","turn_id","result"],"properties":{"tool":{"type":"string","enum":["evaluate_customer"]},"turn_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"result":{"$ref":"#/$defs/Plan"}}},
  "ValidateToolResponse":{"type":"object","additionalProperties":false,"required":["tool","turn_id","result"],"properties":{"tool":{"type":"string","enum":["validate_draft"]},"turn_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"result":{"$ref":"#/$defs/Validation"}}},
  "ToolResponse":{"oneOf":[{"$ref":"#/$defs/EvaluateToolResponse"},{"$ref":"#/$defs/ValidateToolResponse"}]},
  "Error":{"type":"object","additionalProperties":false,"required":["error"],"properties":{"error":{"type":"object","additionalProperties":false,"required":["code","message","request_id","retryable","details"],"properties":{"code":{"type":"string","enum":["UNAUTHORIZED","FORBIDDEN","NOT_FOUND","INVALID_REQUEST","IDEMPOTENCY_CONFLICT","VERSION_CONFLICT","REVIEW_BLOCKED","INVALID_TRANSITION","RATE_LIMITED","AI_TIMEOUT","SERVICE_UNAVAILABLE","INTERNAL_ERROR"]},"message":{"type":"string","minLength":1,"maxLength":500},"request_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"retryable":{"type":"boolean"},"details":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["field","reason"],"properties":{"field":{"anyOf":[{"type":"string","minLength":1,"maxLength":200},{"type":"null"}]},"reason":{"type":"string","minLength":1,"maxLength":500}}},"maxItems":20}}}}},
  "Dataset":{"type":"object","additionalProperties":false,"required":["schema_version","as_of","customers","policy","labels"],"properties":{"schema_version":{"type":"string","enum":["1.0.0"]},"as_of":{"type":"string","format":"date-time"},"customers":{"type":"array","items":{"$ref":"#/$defs/Context"},"maxItems":1000},"policy":{"$ref":"#/$defs/Policy"},"labels":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["customer_id","expected_segments","expected_objective","expected_block_codes"],"properties":{"customer_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,64}$"},"expected_segments":{"type":"array","items":{"type":"string","enum":["consistent","loyalty_candidate","declining_activity","dormant","payment_reminder"]},"maxItems":5},"expected_objective":{"anyOf":[{"type":"string","enum":["appreciation","reward","reengagement","payment_reminder"]},{"type":"null"}]},"expected_block_codes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":100},"maxItems":20}}},"maxItems":1000}}}
 }}
```

### Complete browser exchange examples

Create request, with `Authorization`, `Idempotency-Key: create_CUST001_001` and `X-Request-ID: REQ001`:

```json
{
  "customer_id": "CUST001",
  "channel": "email",
  "locale": "en-IN"
}
```
201 response (synthetic scenario at the dataset clock; model identifier is illustrative):

```json
{
  "draft_id": "DRAFT001",
  "customer_id": "CUST001",
  "revision": 1,
  "status": "ready_for_review",
  "segments": [
    {
      "code": "loyalty_candidate",
      "reason_codes": [
        "LOYALTY_THRESHOLD"
      ],
      "confidence": 1,
      "evidence": [
        {
          "field": "customer.loyalty_points",
          "value": 1200
        },
        {
          "field": "customer.tenure_months",
          "value": 18
        }
      ]
    },
    {
      "code": "consistent",
      "reason_codes": [
        "TIMELY_PAYMENT"
      ],
      "confidence": 1,
      "evidence": [
        {
          "field": "customer.timely_payments_last_3",
          "value": 3
        }
      ]
    }
  ],
  "strategy": {
    "objective": "reward",
    "tone": "warm",
    "template_id": "reward_v1",
    "reminder_stage": "none"
  },
  "selected_offer_id": "OFFER100",
  "message": {
    "subject": "Thank you for your loyalty",
    "body": "Hello Asha,\nThank you for being with us for 18 months. You are eligible for our Loyalty reward: INR 100 reward voucher. Valid for one redemption. No cash alternative. Offer expires 2026-11-30.\nTerms apply. This is a draft for human review.\nContact support for questions or billing disputes."
  },
  "evidence": [
    {
      "field": "customer.loyalty_points",
      "value": 1200
    },
    {
      "field": "customer.tenure_months",
      "value": 18
    }
  ],
  "validation": {
    "passed": true,
    "findings": [],
    "checked_at": "2026-10-31T06:00:00Z",
    "validator_version": "validator_v1"
  },
  "versions": {
    "policy_version": "policy_v1",
    "template_version": "templates_v1",
    "prompt_version": "prompt_v1",
    "model_version": "gemini-configured-model",
    "data_version": "data_v1"
  },
  "campaign_key": "reward_OFFER100_terms_v1",
  "created_at": "2026-10-31T06:00:00Z",
  "updated_at": "2026-10-31T06:00:00Z",
  "approved_by": null,
  "approved_at": null,
  "send_status": "not_sent",
  "delivery_id": null,
  "feedback": null,
  "request_id": "REQ001"
}
```
Approve and mock-deliver with `Idempotency-Key: review_DRAFT001_001`:

```json
{
  "expected_revision": 1,
  "decision": "approve",
  "edited_message": null,
  "feedback": "Verified reward terms and consent.",
  "delivery": "mock_email"
}
```
200 response is the complete same Draft shape, with revision=2, status=mock_sent, approved_by set to the authenticated reviewer, approved_at/updated_at set to server time, send_status=mock_sent, delivery_id set to a new opaque ID, and feedback copied from the request. A GET returns that persisted body. A replay changes neither revision nor outbox count.

Error example (422, no send):

```json
{
  "error": {
    "code": "REVIEW_BLOCKED",
    "message": "Current consent does not allow this outreach.",
    "request_id": "REQ002",
    "retryable": false,
    "details": [
      {
        "field": "consent.marketing_opt_in",
        "reason": "CONSENT_REQUIRED"
      }
    ]
  }
}
```

### Seed dataset and fixtures

File format is UTF-8 JSON `Dataset` (one document, not CSV or JSONL). `customers` is a list of permitted per-customer Context snapshots. IDs are unique; every contact.customer_id must match its containing Context. Campaigns/offers are repeated in contexts for transport convenience but an offer ID and terms_version must have identical values throughout a dataset; backend loads a normalized master catalogue. Validate foreign keys, timestamp consistency and all version invariants on load. Billing `paid` requires amount_due=0; overdue requires a bill ID, positive amount and past due date; disputed requires dispute_open=true; unknown requires amount/due_date/verified_at=null. Missing consent/customer fields fail import. Null activity/payment fields remain unknown. Seed offers, policy and labels are synthetic configuration and evaluation data, not training data. Keep labels out of AI payloads.

A complete one-customer Dataset fixture follows. It also defines the five approved template variants. Freeze test time at as_of; live execution uses the server UTC clock and current snapshots, never a client-supplied clock. Add the scenario variants below to reach the required demonstration coverage.

```json
{
  "schema_version": "1.0.0",
  "as_of": "2026-10-31T06:00:00Z",
  "customers": [
    {
      "customer": {
        "customer_id": "CUST001",
        "display_name": "Asha",
        "active_plan": "PLAN_BASIC",
        "tenure_months": 18,
        "loyalty_points": 1200,
        "activity_current_30d": 15,
        "activity_previous_30d": 15,
        "last_activity_at": "2026-10-30T06:00:00Z",
        "timely_payments_last_3": 3
      },
      "consent": {
        "email_allowed": true,
        "marketing_opt_in": true,
        "service_email_allowed": true,
        "recorded_at": "2026-10-01T00:00:00Z",
        "source": "synthetic_seed"
      },
      "billing": {
        "bill_id": "BILL001",
        "status": "paid",
        "amount_due": {
          "amount_minor": 0,
          "currency": "INR"
        },
        "due_date": "2026-10-15",
        "verified_at": "2026-10-31T06:00:00Z",
        "dispute_open": false,
        "support_text": "Contact support for questions or billing disputes."
      },
      "contacts": [],
      "offers": [
        {
          "offer_id": "OFFER100",
          "title": "Loyalty reward",
          "terms": "INR 100 reward voucher. Valid for one redemption. No cash alternative.",
          "terms_version": "terms_v1",
          "value": {
            "amount_minor": 10000,
            "currency": "INR"
          },
          "valid_from": "2026-10-01T00:00:00Z",
          "expires_at": "2026-11-30T23:59:59Z",
          "channel": "email",
          "min_loyalty_points": 1000,
          "min_tenure_months": 12,
          "allowed_plans": [
            "PLAN_BASIC"
          ],
          "requires_marketing_consent": true
        }
      ],
      "data_version": "data_v1",
      "as_of": "2026-10-31T06:00:00Z"
    }
  ],
  "policy": {
    "policy_version": "policy_v1",
    "template_version": "templates_v1",
    "loyalty_points_threshold": 1000,
    "loyalty_tenure_months": 12,
    "decline_ratio": 0.5,
    "dormant_days": 30,
    "firm_after_days": 15,
    "max_contacts_7d": 2,
    "dedupe_days": 7,
    "billing_max_age_hours": 24,
    "required_disclaimer": "Terms apply. This is a draft for human review.",
    "blocked_phrases": [
      "legal action",
      "disconnect immediately",
      "guaranteed savings"
    ],
    "templates": [
      {
        "template_id": "reward_v1",
        "objective": "reward",
        "tone": "warm",
        "subject": "Thank you for your loyalty",
        "body": "Hello {display_name},\nThank you for being with us for {tenure_months} months. You are eligible for our {offer_title}: {offer_terms} Offer expires {offer_expiry_date}.\n{required_disclaimer}\n{support_text}"
      },
      {
        "template_id": "appreciation_v1",
        "objective": "appreciation",
        "tone": "warm",
        "subject": "Thank you for staying engaged",
        "body": "Hello {display_name},\nThank you for staying engaged with us.\n{required_disclaimer}\n{support_text}"
      },
      {
        "template_id": "reengagement_v1",
        "objective": "reengagement",
        "tone": "encouraging",
        "subject": "We would like to hear from you",
        "body": "Hello {display_name},\nWe would like to help you get more from your current plan. Contact support to explore your options.\n{required_disclaimer}\n{support_text}"
      },
      {
        "template_id": "courteous_v1",
        "objective": "payment_reminder",
        "tone": "courteous",
        "subject": "A reminder about your bill",
        "body": "Hello {display_name},\nOur verified records show {amount_due} due on {due_date}. If you have already paid or wish to dispute this bill, please contact support.\n{required_disclaimer}\n{support_text}"
      },
      {
        "template_id": "firm_v1",
        "objective": "payment_reminder",
        "tone": "firm_respectful",
        "subject": "Please review your overdue bill",
        "body": "Hello {display_name},\nYour bill for {amount_due}, due on {due_date}, remains overdue in our verified records. Please review it and contact support if you need help, have paid, or wish to dispute the amount.\n{required_disclaimer}\n{support_text}"
      }
    ]
  },
  "labels": [
    {
      "customer_id": "CUST001",
      "expected_segments": [
        "consistent",
        "loyalty_candidate"
      ],
      "expected_objective": "reward",
      "expected_block_codes": []
    }
  ]
}
```

| Fixture/scenario | Variation from the complete seed | Required outcome |
|---|---|---|
| consistent.json | CUST002; loyalty_points=100; tenure=3 | consistent; appreciation; ready_for_review |
| loyalty.json | Seed CUST001 unchanged | consistent + loyalty_candidate; reward OFFER100; ready_for_review |
| declining.json | CUST003; loyalty_points=100; tenure=3; activity_current=5; previous=20; timely_payments=2 | declining_activity; reengagement; ready_for_review |
| dormant.json | CUST004; loyalty_points=100; tenure=3; current=0; previous=20; timely_payments=2; last_activity_at=2026-09-01T06:00:00Z | dormant + declining_activity; reengagement |
| overdue.json | CUST005; loyalty_points=100; tenure=3; current=15; previous=15; timely_payments=1; bill status=overdue, amount_minor=149900, due_date=2026-10-20 | payment_reminder; courteous; INR 1499.00 exactly; no offer |
| no_consent.json | Seed with marketing_opt_in=false | blocked with CONSENT_REQUIRED; never deliver |
| disputed.json | Overdue scenario with status=disputed and dispute_open=true | blocked BILLING_DISPUTED; support path |
| unknown_bill.json | status=unknown, amount_due/due_date/verified_at=null | blocked BILLING_UNVERIFIED; no invented bill |
| expired_offer.json | Seed OFFER100 expires_at=2026-10-30T00:00:00Z | reward ineligible; appreciation without offer |
| duplicate.json | Seed a matching recent campaign contact and outbox content hash | blocked DUPLICATE_OUTREACH |
| frequency.json | Two recent mock contacts with distinct campaign keys | blocked CONTACT_FREQUENCY |
| stale_review.json | Generate ready draft, then bump data_version/change consent | approval 409 VERSION_CONFLICT; no outbox |
| edited_claim.json | Edit message to claim INR 999 reward | 422 REVIEW_BLOCKED; revision unchanged |
| injection.json | Customer display_name contains instruction text or sensitive identifiers | reject unsafe dataset or block SENSITIVE_DATA/POLICY_MISMATCH; no tool expansion |

Use exact Context field names when materializing variations; table activity_current/previous/timely_payments abbreviate activity_current_30d/activity_previous_30d/timely_payments_last_3. Re-key nested customer_id/contacts/labels for each customer. Each fixture contains its request, response/error, HTTP status and relevant DB setup, validated against the registry. These are required implementation fixtures; only the complete one-customer JSON above is embedded in this handoff, not a claim that extra fixture files already exist.

### Parallel delivery and five-hour integration plan

The three services work in parallel against this contract; no team imports another team's implementation or database models. React depends on the backend URL and shared types only. AI depends on AIRequest/AIResponse and a ToolClient interface only. Backend depends on an AIClient interface and its own repository, policy and mock-delivery adapters. Shared schemas and fixtures are the integration boundary, not shared runtime code. Use an in-memory/mock implementation for each adapter until its real peer is reachable. Swapping base URLs or adapters must not change JSON.

| Time elapsed | Frontend | Backend | AI |
|---|---|---|---|
| 0–30 min | Extract shared types; build request wrapper and MSW handlers | Freeze/export schemas; seed SQLite and reviewer tokens | Parse AIRequest; implement mock ToolClient and structured response |
| 30–120 min | Customer evidence, segments, draft/review screens against fixtures | Context/draft/review routes, deterministic rules, audit/outbox | Gemini adapter, approved templates, evaluate/validate tool calls |
| 120–180 min | Error, blocked, edit and revision states | Auth, consent/eligibility/billing checks and AIClient | Injection, missing evidence, model failure and timeout handling |
| 180–240 min | Set VITE_USE_MOCKS=false; call real backend | Connect AI host; run end-to-end approval transaction | Replace ToolClient mock with real gateway; verify snapshots |
| 240–300 min | Demo five scenarios and blocked case | Run regression, check outbox/audit and freeze demo data | Produce concise evaluation results and limitations |

Repository plan: `main` is the integration branch to initialize; proposed feature branches `feat/frontend`, `feat/backend`, `feat/ai-service`; proposed directories `frontend/`, `backend/`, `ai-service/`, `contracts/`, `fixtures/`, `evaluation/`. Each team owns its directory. Backend owns schemas and fixtures after the initial jointly reviewed freeze. Copy both Markdown files and extracted schema to contracts/ in the repository as part of implementation; this handoff itself does not push commits. Open small PRs against main, merge contract/fixture baseline first, then integrate modules independently. No force pushes or silent contract changes. Record the integrated commit and actual Gemini model in the README before demo.

Contract verification gates: compare the shared section byte-for-byte; parse the registry and all JSON examples; validate both positive and deliberately invalid examples; ensure every listed endpoint has the same request/response types in both files. Implementation CI must exercise Pydantic/FastAPI response validation and TypeScript fixture consumers, using the same JSON fixtures. Unit tests should cover deterministic thresholds and UTC boundaries; integration tests must verify consent changes, expired offers, stale revisions, repeated idempotency keys, concurrent approvals and unique outbox delivery. Mock the Gemini adapter for deterministic CI; run a separately labelled live smoke test with actual credentials. Do not claim a live service was tested from document verification alone.

Acceptance: all five required segment scenarios plus at least one blocked draft; every fact/amount/date matches evidence; no ineligible offer appears; template/tone selected by policy; evidence, validation and versions visible; edit/approve/reject work; stale and duplicate requests cannot deliver; real SMTP/payment paths absent; complete redacted audit and one mock outbox row per delivered draft. Evaluation report records segment exact-match/precision/recall on labelled fixtures, factual slot correctness, policy pass rate, blocked-case success rate, reviewer relevance/clarity/tone ratings, model errors and known template-limited wording. A small synthetic test set is a demo result, not a production accuracy claim.

### Audit and security ownership

Backend persists customer_id, actor_id, request_id, turn_id, draft_id/revision, input data/policy/template versions, prompt/model version, selected segment/strategy/offer and evidence field names, validation results, normalized output/content hash, reviewer edits/decision/feedback and send status/delivery_id with UTC timestamps. Store draft text in access-controlled storage; logs contain IDs/status/durations, not credentials, customer raw records, email addresses or full prompts. No chain-of-thought collection. Audit writes are required in the same review transaction; an audit failure rolls back mock delivery. Demo retention is 7 days with an explicit cleanup job; idempotency records last at least 24 hours. Only synthetic/anonymized records are used in this hackathon.

Backend owns all permissions and deterministic safety decisions. AI treats profile values, offer text and generated content as untrusted data; it cannot override tools or call unknown tools. Frontend escapes text and renders plain text with preserved newlines, never raw HTML/Markdown from the model. Limit body size to 64 KiB public and 256 KiB internal; reject oversize bodies as 422 INVALID_REQUEST. Restrict tailnet access/firewall to team machines and intended ports; restrict internal operations to service identities; keep .env ignored and secrets server-side. No bulk sending, billing modification, autonomous reward redemption, inferred consent or real email delivery is in this contract.
<!-- END SHARED FROZEN CONTRACT -->
