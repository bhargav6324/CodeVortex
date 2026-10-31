# CodeVortex AI service

Gemini orchestration service for the HCLTech Customer Loyalty & Engagement Assistant. It implements shared contract **v1.0.0** ([AI_SERVICE_CONTRACT.md](../AI_SERVICE_CONTRACT.md)) and exposes one internal operation, called only by the backend:

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/internal/v1/generate` | `AIRequest` | `AIResponse` (200) or `Error` |

```
React ─► Backend (100.83.115.82:8000) ─► AI service (100.114.163.7:8001) ─► Gemini
                         ▲                         │
                         └── POST /internal/v1/tools/execute (evaluate_customer, validate_draft)
```

The AI service holds no customer data and makes no business decisions. Customers, policy, classification, eligibility, billing, consent and validation all belong to the backend. The AI service sequences the two backend tools around one Gemini call and returns the result. It never sends email or writes business state.

## One turn

1. Auth (`Authorization: Bearer <AI_SERVICE_TOKEN>` + `X-Delegation-Token`), then the body and scope checks (`customer_id` and `as_of` must match `context`).
2. `evaluate_customer` → `Plan`. If its validation failed → `blocked`, `message=null`, `model_version=not_invoked`; Gemini is not called.
3. Gemini fills the approved template (`prompt_v1`). One repair attempt if the reply is unusable or the call fails, then `unavailable`.
4. `validate_draft` on the candidate → pass: `generated`; fail: `blocked` with the tool's validation (candidate kept visible, no evidence).

| Result | HTTP | Backend maps it to |
| --- | --- | --- |
| `generated` / `blocked` / `unavailable` | 200 `AIResponse` | ready_for_review / blocked draft / 503 |
| Whole turn over 22 s | 504 `AI_TIMEOUT` (retryable) | retry with the same key |
| Tool timeout, unreachable tool, inconsistent tool output | 503 `SERVICE_UNAVAILABLE` | error |
| Tool auth/scope/schema errors | same code and status as the backend sent, redacted | error |
| Bad credentials / bad body or headers / scope mismatch | 401 / 422 / 403 | error |

Limits: at most 2 tool calls, at most 2 Gemini attempts, 3 s per tool call, 15 s total for Gemini, 22 s per turn, 256 KiB request body.

Every response carries `X-Request-ID` (echoed, or generated), `X-Contract-Version: 1.0.0` and `Cache-Control: no-store`.

## Setup

```bash
cd ai-service
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Windows; .venv/bin/python on macOS/Linux
cp .env.example .env                                        # then fill in the values below
```

| Variable | Purpose |
| --- | --- |
| `AI_SERVICE_TOKEN` | Backend → AI bearer credential; must equal the backend's value |
| `BACKEND_TOOL_BASE_URL` | Backend tool gateway, default `http://100.83.115.82:8000` |
| `BACKEND_TOOL_TOKEN` | AI → backend bearer credential; must equal the backend's value |
| `GEMINI_API_KEY` | Gemini key (server secret) |
| `GEMINI_MODEL` | Gemini model, default `gemini-3.5-flash-lite` |
| `TELEMETRY_PATH` | Per-turn JSONL log, default `logs/turns.jsonl` |

`.env` and `logs/` are git-ignored. Secrets never appear in prompts, responses or logs.

## Run

```powershell
powershell -ExecutionPolicy Bypass -File run.ps1     # uvicorn on 0.0.0.0:8001
```

So the backend Mac can reach this machine, allow port 8001 from Tailscale addresses only (once, in an **administrator** PowerShell):

```powershell
New-NetFirewallRule -DisplayName "CodeVortex AI service (Tailscale)" -Direction Inbound -Protocol TCP -LocalPort 8001 -RemoteAddress 100.64.0.0/10 -Action Allow
```

Check the backend from here: `.venv/Scripts/python scripts/check_backend.py` (calls its `GET /health`).

## Test

```bash
.venv/Scripts/python -m pytest          # offline: no API key, no network
```

The tests use only the contract's own examples (`contract/examples/`, extracted unchanged from the shared contract), plus test doubles for the backend tools and Gemini. The Pydantic models are checked against the frozen JSON Schema (`contract/schema-1.0.0.json`).

Live checks are separate from pytest:

- `scripts/gemini_smoke.py [model ...]`: one real Gemini call on the contract's seed customer; prints model version and time
- `scripts/check_backend.py`: backend reachability over Tailscale

## Gemini

- Model: `gemini-3.5-flash-lite` (provider-reported version `gemini-3.5-flash-lite` on 2026-10-31). The response's `model_version` is always the version Gemini reports, or `not_invoked` when no call was made
- Prompt `prompt_v1` (`app/generation/prompt.py`): instructions only in the system text; turn data sent as a JSON block marked untrusted; only the facts the selected template needs (no bill/account numbers or email addresses)
- Output: JSON schema `{message: {subject, body}, evidence_fields: [...]}`, temperature 0. Evidence values always come from the snapshot, never from model text. No tools are offered to the model, and a model-requested call is rejected

Live smoke results on 2026-10-31 (contract seed CUST001, reward_v1); all returned the canonical message exactly:

| Requested model | Reported version | Time |
| --- | --- | --- |
| gemini-3.5-flash-lite | gemini-3.5-flash-lite | 1.3 s |
| gemini-2.5-flash-lite | gemini-2.5-flash-lite | 1.5 s |
| gemini-2.5-flash | gemini-2.5-flash | 5.1 s |
| gemini-3.5-flash | gemini-3.6-flash | 6.5 s |
| gemini-flash-latest | gemini-3.8-flash | 6.5 s |

Live end to end on 2026-10-31 against the real backend over Tailscale: all 50 labelled customers created drafts with 0 HTTP errors. 29 reached Gemini and all passed `validate_draft`; 21 were pre-blocked by the backend. Results and analysis are in [EVALUATION.md](../EVALUATION.md).

## Telemetry and evaluation

Each turn appends one line to `TELEMETRY_PATH`: request/turn/customer IDs, outcome or error code, segment codes, objective, template, finding codes, evidence field names, model and prompt versions, tool-call and Gemini-attempt counts, and timings. It holds no message text, prompts, evidence values or credentials.

After running the backend's labelled customers through real turns:

```bash
.venv/Scripts/python scripts/evaluate.py --labels <backend Dataset or labels JSON>   # writes ../EVALUATION.md
```

The report covers segment exact match, per-segment precision/recall, objective match, blocked-case success, the validate_draft pass rate for model candidates, model failures, HTTP errors, latency and model versions. Customers without a recorded turn are listed, not scored.

## Limitations

- **Synthetic data:** the hackathon uses synthetic, backend-supplied records. Results are demo results, not production accuracy.
- **Deterministic rules live in the backend:** the AI service passes the backend's segments, strategy and eligibility through unchanged and does not re-check them.
- **Template-limited text:** v1 only allows Gemini to reproduce the approved template with verified slots, because free paraphrase cannot be validated safely in the time available. Wording variety comes only from the five approved templates.
- **Model availability:** the model is chosen from what the key can access on the day. Gemini outages or slow replies produce `unavailable` (backend 503) or `504 AI_TIMEOUT`, never a fabricated draft. A template fallback is not used, so it can never be mislabelled as Gemini output.
- **Delegation tokens are opaque here:** the AI service checks they are present and forwards them; the backend verifies signature, scope and expiry.
- **Evidence citation is optional for the model:** in 7 of 30 live turns Gemini cited no evidence fields (allowed by the contract).

## Layout

```
app/
  main.py               app factory, middleware, shared HTTP client
  settings.py           env-based config (secrets never in code)
  contract/models.py    Pydantic models for the v1.0.0 registry
  http/                 Error envelope, request-ID/contract headers, service auth, body limit
  api/generate.py       POST /internal/v1/generate (wiring, dependencies, telemetry)
  orchestrator.py       one bounded turn: evaluate -> Gemini -> validate
  tools/client.py       ToolClient interface + HttpToolClient (backend tool gateway)
  generation/           template rendering, prompt_v1, reply parsing
  llm/gemini.py         GeminiAdapter interface + GoogleGeminiAdapter
  telemetry.py          per-turn JSONL records
  evaluation.py         metrics + EVALUATION.md rendering
contract/               frozen schema + contract examples
scripts/                check_backend.py, gemini_smoke.py, evaluate.py
tests/
run.ps1
```
