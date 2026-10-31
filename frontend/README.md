# LoyaltyAI — CodeVortex reviewer frontend

React + TypeScript + Vite + Tailwind CSS, built to the backend team's `FRONTEND_GUIDE.md` and the
frozen shared contract v1.0.0. Lucide icons, Recharts charts, MSW mock backend.

## Tabs (from FRONTEND_GUIDE.md)

| Tab | Route | Backend support |
|---|---|---|
| Review workspace | `/review` | Contract 1.0.0: context, create draft, get draft, review |
| AI assistant (conversation) | `/assistant` | Same four calls shown as a chat. Never talks to Gemini directly |
| Statistics ("This session") | `/statistics` | Drafts this browser session created or opened, re-fetched on open/Refresh |
| Audit & outbox | `/audit` | Proposed v1.1 `/details`; **hidden while the backend reports 1.0.0** |

The header shows `Backend online · contract X` (checked every 30 s) and the reviewer token box.
There is no login and no roles: each reviewer pastes their own token, kept in memory only.
`/legacy` keeps the earlier single-page reviewer screen as a fallback.

## Run it

```bash
cd frontend
npm install
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
npm run dev
```

Open http://localhost:5173 (teammates on Tailscale: http://100.117.73.55:5173).

## Configuration (`.env`)

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | FastAPI backend, default `http://100.83.115.82:8000` |
| `VITE_USE_MOCKS` | `true` = in-browser MSW mock backend, `false` = real backend |

Switching `VITE_USE_MOCKS` is the only change needed to move from mocks to the real backend.
Restart `npm run dev` after editing `.env`.

Never put tokens or keys in `.env`: every `VITE_` value ends up in the browser bundle.
The reviewer token is pasted into the UI and kept in memory only.

## Mock backend

With `VITE_USE_MOCKS=true` the app uses `src/mocks/` instead of the network.

- Tokens: any value = valid reviewer `reviewer_demo`, `expired` = 401, `forbidden` = 403.
- Customers: the agreed scenario customers use the backend's IDs (C001 consistent, C004 loyalty,
  C008 declining, C011 dormant, C014 payment reminder, C007 no consent, C019 disputed,
  C023 missing data, C036 channel blocked). Names and numbers are mock data. `MOCK_*` customers
  are extra edge cases (expired offer, duplicate, frequency, stale data, unsafe data, AI timeout,
  AI down) that exist only in the mock.
- Drafts survive a page reload (sessionStorage). Use "Reset mock data" to clear them.

## Switching to the real backend

The backend (`http://100.83.115.82:8000`) serves customers **C001–C050**.

1. **Get a reviewer token** from the backend team (sent privately; it expires). Never use the
   `AI_SERVICE_TOKEN` or `BACKEND_TOOL_TOKEN`: those are backend-to-AI secrets, not for the browser.
2. **Check the backend from the command line.** The default customer is C007 (blocked, so it never
   calls the AI service):

   ```powershell
   $env:REVIEWER_TOKEN="<token>"; npm run check:backend
   ```

   - While the backend runs in-memory, review (edit/approve/reject) returns 503 by design. Skip it:
     `$env:SKIP_REVIEW="1"; npm run check:backend` (clear it afterwards with `Remove-Item Env:SKIP_REVIEW`).
   - To exercise AI generation once the AI service on port 8001 is up: `$env:CUSTOMER_ID="C004"`.

   Every line must say PASS (or SKIP). A FAIL names the endpoint and the exact field or header that
   differs from contract v1.0.0. Send it to the backend team with the request ID; do not change the
   frontend types to match.
3. **Switch the app:** set `VITE_USE_MOCKS=false` in `.env`, restart `npm run dev`.
   The picker then lists C001–C050 (scenario customers labelled) and hides `MOCK_*` customers.
4. **Click through the scenario customers** with the real token. In development the header shows a
   red "contract mismatch" badge if any request or response breaks the schema; click it for details.
5. **Once review is enabled (SQLite):** approve one draft with "Mock email" and ask the backend team
   to confirm exactly one outbox row was written.

To go back to mocks at any time, set `VITE_USE_MOCKS=true` and restart.

## Proposed contract v1.1.0 features

`contracts/PROPOSAL_v1.1.0.md` proposes two additive endpoints for gaps in the brief:
reviewer rubric ratings, offer eligibility reasons, audit trail and the mock outbox row.

- The UI shows these panels **only when `/health` reports `contract_version: "1.1.0"`**.
  Against a 1.0.0 backend they stay hidden and nothing else changes.
- The mock backend implements the proposal, so with `VITE_USE_MOCKS=true` you see them now.
- `npm run check:backend` adds `[v1.1]` checks automatically when the backend reports 1.1.0.

## Tests

| Command | What it checks |
|---|---|
| `npm test` | Every mock response matches the contract schema; mock backend follows the contract rules; the backend smoke test passes against the mocks |
| `npm run check:backend` | The real backend against the contract (see above) |

## Project layout

```
src/
  App.tsx               routes (four tabs + /legacy)
  app/                  providers: reviewer token (memory), shared /health poller, review + assistant state
  layout/               AppLayout, navy Sidebar, Header (status + token), navigation.ts (tab table)
  features/review/      Tab 1: CustomerList, FactsPanel, DecisionPanel, EmailPanel, page
  features/assistant/   Tab 2: command parser, conversation provider, chat page
  features/statistics/  Tab 3: computeStats (pure), charts page, demo-scenario runner
  features/audit/       Tab 4: timeline, eligibility, mock outbox (v1.1 only)
  features/session/     sessionLog: draft IDs, browser timings and error counts (sessionStorage)
  ui/                   shared Tailwind components (Card, Badge, Button, Alert/ErrorAlert, StatTile…)
  hooks/                useReviewWorkflow (idempotency, retry, recovery), useDraftDetails, useBackendHealth
  api/                  the one request wrapper, endpoints, errors, contract schema checks
  mocks/                MSW mock backend + scenario fixtures
  types/                contract types + JSON Schemas (v1.0.0 frozen, v1.1.0 accepted proposal)
  legacy/               the earlier reviewer screen (/legacy)
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on port 5173 |
| `npm run build` | Type-check and production build |
| `npm run lint` | Lint with oxlint |
| `npm test` | Contract and mock-backend tests (Vitest) |
| `npm run check:backend` | Smoke-test the real backend against the contract |
