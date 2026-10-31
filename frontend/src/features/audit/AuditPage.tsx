/**
 * Tab 4 — Audit and outbox (PROPOSED, contract v1.1.0). Per draft: event timeline, offer
 * eligibility reasons and the mock outbox entry, from GET /drafts/{id}/details.
 * Hidden while the backend reports 1.0.0; the mock backend implements it for demos.
 */
import { CheckCircle2, Gift, History, Inbox, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getDraft } from '../../api/endpoints'
import { toApiError, type ApiError } from '../../api/errors'
import { useHealth, useToken } from '../../app/context'
import { useDraftDetails } from '../../hooks/useDraftDetails'
import type { Draft } from '../../types/contract'
import { formatUtc } from '../../utils/format'
import { AUDIT_EVENT_LABELS, ELIGIBILITY_REASON_LABELS, STATUS_DISPLAY } from '../../utils/labels'
import { Alert, ErrorAlert } from '../../ui/Alert'
import { Card } from '../../ui/Card'
import { Badge, Code, EmptyState, Field, Fields, PlainText, Spinner } from '../../ui/primitives'
import { useSessionLog } from '../session/sessionLog'

const DOT: Record<string, string> = {
  draft_created: 'bg-brand-500',
  draft_blocked: 'bg-rose-500',
  edited: 'bg-sky-500',
  approved: 'bg-emerald-500',
  mock_sent: 'bg-emerald-500',
  rejected: 'bg-rose-500',
  rated: 'bg-violet-500',
}

function DraftDetailsView({ draft }: { draft: Draft }) {
  const { details, error } = useDraftDetails(draft, true)
  if (error) return <ErrorAlert title="Could not load the draft details" error={error} />
  if (!details) return <Spinner label="Loading audit details…" />
  const events = [...details.audit].sort((a, b) => a.at.localeCompare(b.at) || a.event_id.localeCompare(b.event_id))

  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <Card title={`Audit trail · ${events.length}`} icon={History}>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">No audit events recorded.</p>
        ) : (
          <ol className="relative space-y-5 border-l-2 border-slate-100 pl-6">
            {events.map((e) => (
              <li key={e.event_id} className="relative">
                <span className={`absolute -left-[31px] top-1 size-3.5 rounded-full ring-4 ring-white ${DOT[e.event_type] ?? 'bg-slate-400'}`} aria-hidden="true" />
                <p className="flex flex-wrap items-baseline gap-2 text-sm">
                  <strong className="text-slate-900">{AUDIT_EVENT_LABELS[e.event_type]}</strong>
                  <span className="text-xs text-slate-500">
                    rev {e.revision} · {formatUtc(e.at)} · <span className="font-mono">{e.actor_id}</span>
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-slate-700">{e.summary}</p>
                {e.evidence_fields.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {e.evidence_fields.map((f) => (
                      <Code key={f}>{f}</Code>
                    ))}
                  </div>
                )}
                <p className="mt-1 font-mono text-[11px] text-slate-400">request {e.request_id}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="space-y-5">
        <Card title={`Offer eligibility · ${details.eligibility.length}`} icon={Gift}>
          {details.eligibility.length === 0 ? (
            <p className="text-sm text-slate-500">No eligibility data for this draft (no offers evaluated, or the draft predates stored eligibility).</p>
          ) : (
            <ul className="space-y-2">
              {details.eligibility.map((el) => (
                <li key={el.offer_id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <Code>{el.offer_id}</Code>
                    <Badge tone={el.eligible ? 'success' : 'neutral'}>{el.eligible ? 'Eligible' : 'Not eligible'}</Badge>
                    {el.offer_id === draft.selected_offer_id && <Badge tone="brand">Selected</Badge>}
                  </p>
                  {!el.eligible && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {el.reason_codes.map((r) => (
                        <span key={r} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
                          {ELIGIBILITY_REASON_LABELS[r]} <Code>{r}</Code>
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Mock outbox" icon={Inbox}>
          {details.outbox === null ? (
            draft.status === 'mock_sent' ? (
              <p className="text-sm font-semibold text-rose-700">The draft says mock sent, but no outbox row was returned. Report this to the backend team.</p>
            ) : (
              <p className="text-sm text-slate-500">Nothing was delivered for this draft.</p>
            )
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle2 className="size-4" aria-hidden="true" /> One mock outbox row. No real email was sent.
              </p>
              <Fields>
                <Field label="Delivery ID" value={details.outbox.delivery_id} mono />
                <Field label="Delivered" value={formatUtc(details.outbox.delivered_at)} />
                <Field label="Campaign key" value={details.outbox.campaign_key} mono />
                <Field label="Content hash" value={details.outbox.content_hash} mono />
              </Fields>
              <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
                <div className="border-b border-slate-100 bg-slate-50 px-3.5 py-2 text-sm font-semibold">
                  <PlainText>{details.outbox.subject}</PlainText>
                </div>
                <div className="px-3.5 py-3 text-sm text-slate-700">
                  <PlainText>{details.outbox.body}</PlainText>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

export function AuditPage() {
  const health = useHealth()
  const { tokenSet } = useToken()
  const log = useSessionLog()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<ApiError | null>(null)

  const activeId = selectedId ?? log.drafts.at(-1)?.draftId ?? null

  useEffect(() => {
    if (!activeId || !tokenSet || !health.extensions) return
    let active = true
    getDraft(activeId)
      .then((res) => {
        if (active) {
          setDraft(res.data)
          setError(null)
        }
      })
      .catch((e) => {
        if (active) setError(toApiError(e))
      })
    return () => {
      active = false
    }
  }, [activeId, tokenSet, health.extensions])

  if (!health.extensions) {
    return (
      <Card>
        <EmptyState icon={Lock} title="Available from contract 1.1.0">
          The backend reports contract {health.version ?? 'unknown'}. Audit, outbox and eligibility need the proposed GET /drafts/{'{id}'}/details endpoint, so this tab stays hidden until the backend ships it.
        </EmptyState>
      </Card>
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card title="Session drafts" icon={History} bodyClassName="p-2">
        {log.drafts.length === 0 ? (
          <p className="p-3 text-sm text-slate-500">No drafts in this session yet. Generate one in the Review workspace or the assistant.</p>
        ) : (
          <ul className="space-y-1" role="listbox" aria-label="Session drafts">
            {[...log.drafts].reverse().map((d) => (
              <li key={d.draftId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={d.draftId === activeId}
                  onClick={() => setSelectedId(d.draftId)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${d.draftId === activeId ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="font-mono text-xs">{d.draftId}</span>
                  <span className="font-mono text-xs text-slate-500">{d.customerId}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="min-w-0 space-y-4">
        {!tokenSet && <Alert tone="warning" title="Paste your reviewer token to load audit details." />}
        {error && <ErrorAlert title="Could not load the draft" error={error} />}
        {draft && draft.draft_id === activeId && (
          <>
            <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span className="font-mono">{draft.draft_id}</span> · <span className="font-mono">{draft.customer_id}</span>
              <Badge tone={STATUS_DISPLAY[draft.status].tone}>{STATUS_DISPLAY[draft.status].label}</Badge>
              <span>rev {draft.revision}</span>
            </p>
            <DraftDetailsView key={`${draft.draft_id}:${draft.revision}:${draft.status}`} draft={draft} />
          </>
        )}
      </div>
    </div>
  )
}
