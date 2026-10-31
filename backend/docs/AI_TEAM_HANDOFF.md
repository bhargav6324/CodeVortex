# AI service integration handoff

Deployment note: the next SQLite/reviewer implementation is documented in DATABASE_AND_REVIEW.md and TESTER_DATABASE_REVIEW.md. The currently running Phase 3 memory server is deliberately unchanged during the tester's active pass. Statements below describe that Phase 3 baseline; after coordinated SQLite cutover, use the newer review/persistence handoff.

Phase 3 implementation is ready for the separate tester to verify. No API calls or test suites were run during this phase at the user's request. Startup alone is not proof of connectivity or correctness.

## Addresses and ownership

- Backend intended base URL: http://100.83.115.82:8000
- AI service intended base URL: http://100.114.163.7:8001
- React origin: http://100.117.73.55:5173
- Backend docs: http://100.83.115.82:8000/docs

Backend owns deterministic segmentation, strategy, consent, eligibility, billing, contact limits, content validation and storage. AI owns POST /internal/v1/generate, Gemini orchestration and structured AIResponse. React calls the backend only. Use the existing frozen schemas in contracts/schema.json and the two contract Markdown files; no wire fields or paths were added in Phase 3.

The active local dataset uses C001–C050. Old CUST001-style IDs are only examples from the original handoff and are not active rows on this server. Obtain service credentials directly from the backend owner through the team's approved private method; there are no real tokens in this file.

## End-to-end handshake

1. A reviewer calls POST /api/v1/drafts with a reviewer bearer token, Idempotency-Key, optional X-Request-ID and this body:

```json
{"customer_id":"C001","channel":"email","locale":"en-IN"}
```

2. Backend assembles context and policy, evaluates the deterministic rules and creates an immutable, customer-scoped 60-second turn. Preblocked inputs create a blocked draft immediately without an AI/Gemini call. They return 201 and model_version=not_invoked.
3. For a permitted plan, backend calls your POST /internal/v1/generate with AIRequest, Authorization: Bearer <AI_SERVICE_TOKEN>, X-Delegation-Token and X-Request-ID. Verify the service credential. Treat the delegation as an opaque capability, never a prompt input or something to mint yourself.
4. Call the backend tool endpoint twice in sequence, using Authorization: Bearer <BACKEND_TOOL_TOKEN>, the same X-Delegation-Token and request ID. Only evaluate_customer then validate_draft are permitted, once each. Use the received customer_id and turn_id, not hardcoded example IDs.

Evaluate example (replace the turn ID with the value received in AIRequest):

```json
{"tool":"evaluate_customer","turn_id":"TURN_from_AIRequest","arguments":{"customer_id":"C001"}}
```

The 200 body is EvaluateToolResponse: tool, turn_id and result=Plan. It includes all segments/reasons/evidence, selected strategy/offer, eligibility for all offers, campaign_key and validation. Backend reads its stored snapshot, not model-supplied evidence. Do not alter the returned plan.

5. If permitted, ask Gemini for a Message and allowlisted factual evidence using the selected approved template. The canonical message is a single substitution of approved placeholders. v1 does not allow free paraphrasing. The captured policy includes the exact template text; money in bill reminders is INR plus two decimal digits. A reward copies the approved terms exactly. Use a configured available Gemini model and record its actual/configured identity. No fake model labels or hidden reasoning.
6. Call validate_draft with Message and the IDs from the returned Plan:

```json
{
  "tool":"validate_draft",
  "turn_id":"TURN_from_AIRequest",
  "arguments":{
    "customer_id":"C001",
    "message":{"subject":"Replace with approved rendered subject","body":"Replace with approved rendered body"},
    "selected_offer_id":"OFFER100",
    "template_id":"reward_v1"
  }
}
```

This is an illustrative payload shape, not an executed request or valid rendered candidate. selected_offer_id must be null for objectives without an offer. Use plan.strategy.template_id, never assume reward_v1 for every customer.

7. The tool returns ValidateToolResponse: tool, turn_id and result=Validation. Replace only plan.validation with that returned result. Return AIResponse with the original turn_id/plan, exact candidate Message, factual evidence, generation_status (generated if passed, blocked if failed), prompt_version and model_version. Evidence field paths are customer.*, billing.*, consent.*, offers.<offer_id>.* or policy.required_disclaimer, and values must exactly match the request snapshot. Evidence values are primitives, not lists/objects.
8. Backend requires proof that both tool calls occurred, checks candidate hash and the entire plan, validates source evidence, checks current customer/policy for changes and independently revalidates content before saving a draft. All drafts remain not_sent. Turn capabilities are revoked when generation finishes or fails.

## Errors and deadlines

Use the frozen Error envelope, never arbitrary provider SDK errors. Missing/wrong service credential: 401. Wrong customer/turn/version or missing/expired snapshot: 403. Unknown tool/bad JSON: 422. Repeated or out-of-order tool: 409 INVALID_TRANSITION. Policy refusal is a 200 tool result with passed=false. Candidate offer/template mismatch is a validation finding, not a write action.

Unavailable Gemini or parsing failure after at most one repair should return AIResponse generation_status=unavailable and message=null; backend returns 503 and does not save a draft. Never silently turn a template fallback into a claimed Gemini result. Internal credential/delegation values must not appear in output.

Backend AI budget: 25 seconds total, connect timeout 3 seconds, maximum response 256 KiB, no redirects or proxy-environment forwarding. AI orchestrator budget remains 22 seconds, at most two tool calls and at most one repair. Tools use the captured snapshot clock; backend persistence rechecks the actual current UTC clock. Do not accept a browser-selected clock or policy. A changed body cannot reuse an idempotency key. Identical successful generation replay returns the same draft as HTTP 200.

## Scope

No new public token-generation/snapshot endpoint was added. Tools are usable only during a backend-started generation request. They cannot be called with an invented turn ID. Use an offline ToolClient plus frozen fixtures for isolated AI development, then connect the actual callback flow with the tester. No review, real email, billing action, consent change or reward redemption is enabled by these tools.
