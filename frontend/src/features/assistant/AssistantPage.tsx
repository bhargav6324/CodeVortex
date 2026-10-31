/**
 * Tab 2 — AI assistant (conversation view). A chat over the same four backend calls.
 * The browser never talks to the AI service or Gemini, and prompts/model reasoning are never
 * shown (the backend never returns them).
 */
import { Bot, Check, CheckCircle2, Eraser, PencilLine, RotateCcw, Send, ShieldAlert, ShieldCheck, Sparkles, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Context, Draft, Evidence } from '../../types/contract'
import { formatUtc } from '../../utils/format'
import { FINDING_LABELS, REASON_LABELS, SEGMENT_LABELS, STATUS_DISPLAY } from '../../utils/labels'
import { getAllowedActions } from '../../utils/reviewRules'
import { ErrorAlert } from '../../ui/Alert'
import { Card } from '../../ui/Card'
import { Badge, Button, Code, PlainText } from '../../ui/primitives'
import { useAssistant, type ChatMessage } from './assistantContext'

const QUICK_REPLIES = [
  { label: 'Draft for C001', text: 'Draft an email for C001' },
  { label: 'C004 (reward)', text: 'Draft an email for C004' },
  { label: 'C014 (payment reminder)', text: 'Draft an email for C014' },
  { label: 'C007 (blocked)', text: 'Draft an email for C007' },
]

/** Evidence as a plain phrase, e.g. "1,200 loyalty points, 18 months tenure" (guide example). */
const PHRASES: Record<string, (v: string) => string> = {
  'customer.loyalty_points': (v) => `${v} loyalty points`,
  'customer.tenure_months': (v) => `${v} months tenure`,
  'customer.timely_payments_last_3': (v) => `${v} of the last 3 bills paid on time`,
  'customer.activity_current_30d': (v) => `${v} activities in the last 30 days`,
  'customer.activity_previous_30d': (v) => `${v} in the 30 days before`,
  'customer.last_activity_at': (v) => `last active ${v.slice(0, 10)}`,
  'billing.status': (v) => `bill ${v}`,
  'billing.due_date': (v) => `due ${v}`,
  'consent.marketing_opt_in': (v) => `marketing opt-in: ${v}`,
  'consent.email_allowed': (v) => `email allowed: ${v}`,
}

function describeEvidence(e: Evidence): string {
  if (e.value === null) return `${e.field.split('.').pop()?.replace(/_/g, ' ')} unknown`
  if (typeof e.value === 'number' && e.field.endsWith('amount_minor')) return `INR ${(e.value / 100).toFixed(2)} due`
  if (e.field === 'billing.dispute_open') return e.value ? 'billing dispute open' : 'no open dispute'
  const text = typeof e.value === 'number' ? e.value.toLocaleString('en-IN') : typeof e.value === 'boolean' ? (e.value ? 'yes' : 'no') : e.value
  const phrase = PHRASES[e.field]
  return phrase ? phrase(text) : `${e.field.split('.').pop()?.replace(/_/g, ' ')}: ${text}`
}

function Bubble({ icon: Icon, title, children, tone = 'normal' }: { icon: typeof Bot; title?: string; children: ReactNode; tone?: 'normal' | 'success' | 'danger' | 'warning' }) {
  const ring = { normal: 'ring-slate-200', success: 'ring-emerald-200 bg-emerald-50/50', danger: 'ring-rose-200 bg-rose-50/50', warning: 'ring-amber-200 bg-amber-50/60' }[tone]
  return (
    <div className={`rounded-2xl rounded-tl-md bg-white p-4 shadow-sm ring-1 ring-inset ${ring}`}>
      {title && (
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Icon className="size-3.5" aria-hidden="true" />
          {title}
        </p>
      )}
      <div className="text-sm leading-relaxed text-slate-800">{children}</div>
    </div>
  )
}

function DraftAnswer({ headline, draft, context, ms, latest }: { headline: string; draft: Draft; context: Context | null; ms: number | null; latest: boolean }) {
  const a = useAssistant()
  const status = STATUS_DISPLAY[draft.status]
  const offer = draft.selected_offer_id ? context?.offers.find((o) => o.offer_id === draft.selected_offer_id) : null
  const blocks = draft.validation.findings.filter((f) => f.severity === 'block')
  const allowed = getAllowedActions(draft, false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <div className="space-y-2.5">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
        {headline}
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="text-xs text-slate-400">rev {draft.revision}</span>
      </p>

      <Bubble icon={UserRound} title="1 · Who this customer is">
        {draft.segments.length === 0 ? (
          <p>No segment matched from the available evidence.</p>
        ) : (
          <ul className="space-y-1">
            {draft.segments.map((s) => (
              <li key={s.code}>
                {s.evidence.map(describeEvidence).join(', ')} → <strong>{SEGMENT_LABELS[s.code]}</strong>{' '}
                <span className="text-slate-500">({s.reason_codes.map((r) => REASON_LABELS[r]).join(', ')})</span>
              </li>
            ))}
          </ul>
        )}
      </Bubble>

      <Bubble icon={Sparkles} title="2 · What I recommend">
        {offer ? (
          <p>
            Include <strong>{offer.title}</strong>: {offer.terms}
          </p>
        ) : (
          <p>No offer.</p>
        )}
      </Bubble>

      <Bubble icon={Send} title="3 · The draft">
        {draft.message ? (
          <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
            <div className="border-b border-slate-100 bg-slate-50 px-3.5 py-2 font-semibold">
              <PlainText>{draft.message.subject}</PlainText>
            </div>
            <div className="px-3.5 py-3">
              <PlainText>{draft.message.body}</PlainText>
            </div>
          </div>
        ) : (
          <p>No message was written for this draft.</p>
        )}
      </Bubble>

      <Bubble icon={draft.validation.passed ? ShieldCheck : ShieldAlert} title="4 · Safety checks" tone={draft.validation.passed ? 'success' : 'danger'}>
        {draft.validation.findings.length === 0 ? (
          <p className="flex items-center gap-1.5 font-medium text-emerald-800">
            <CheckCircle2 className="size-4" aria-hidden="true" /> All checks passed.
          </p>
        ) : (
          <ul className="space-y-1">
            {draft.validation.findings.map((f, i) => (
              <li key={i}>
                <Code>{f.code}</Code> <strong>{FINDING_LABELS[f.code]}</strong>: {f.message}
              </li>
            ))}
          </ul>
        )}
        {blocks.length > 0 && context && <p className="mt-2 text-slate-700">Support path: {context.billing.support_text}</p>}
      </Bubble>

      <p className="px-1 font-mono text-[11px] text-slate-400">
        model {draft.versions.model_version} · prompt {draft.versions.prompt_version} · request {draft.request_id}
        {ms !== null && <> · took {(ms / 1000).toFixed(1)} s</>}
        {draft.approved_at && <> · approved {formatUtc(draft.approved_at)}</>}
      </p>

      {latest && !allowed.isFinal && !a.editing && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" icon={PencilLine} onClick={a.openEditor} disabled={a.busy || !allowed.edit}>
            Edit
          </Button>
          <Button size="sm" variant="primary" icon={Check} onClick={() => a.approve('draft_only')} disabled={a.busy || !allowed.approve}>
            Approve draft
          </Button>
          <Button size="sm" icon={Send} onClick={() => a.approve('mock_email')} disabled={a.busy || !allowed.approve}>
            Approve and mock-send
          </Button>
          <Button size="sm" variant="danger" icon={X} onClick={() => setRejecting((v) => !v)} disabled={a.busy}>
            Reject
          </Button>
          {allowed.approveReason && <p className="w-full text-xs text-slate-500">{allowed.approveReason}</p>}
        </div>
      )}
      {latest && rejecting && !allowed.isFinal && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setRejecting(false)
            a.reject(reason.trim() || null)
          }}
        >
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Reason, e.g. Wrong tone" className="h-8 flex-1 rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-4 focus:ring-brand-100" />
          <Button size="sm" type="submit" variant="danger" disabled={a.busy}>
            Reject draft
          </Button>
        </form>
      )}
      {latest && a.editing && draft.message && <InlineEditor key={`${draft.draft_id}:${draft.revision}`} draft={draft} />}
    </div>
  )
}

function InlineEditor({ draft }: { draft: Draft }) {
  const a = useAssistant()
  const [subject, setSubject] = useState(draft.message?.subject ?? '')
  const [body, setBody] = useState(draft.message?.body ?? '')
  return (
    <div className="space-y-2 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
      {a.editRefused && <p className="text-sm font-semibold text-rose-700">That edit was refused; the draft is unchanged. Your text is kept so you can fix it.</p>}
      <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} aria-label="Subject" className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-4 focus:ring-brand-100" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={7} aria-label="Body" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-[13px] focus:outline-none focus:ring-4 focus:ring-brand-100" />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon={Check} onClick={() => a.saveEdit(subject, body)} disabled={a.busy || !subject.trim() || !body.trim()}>
          Save edit
        </Button>
        <Button size="sm" variant="ghost" onClick={a.closeEditor} disabled={a.busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Message({ msg, latestDraftId }: { msg: ChatMessage; latestDraftId: string | null }) {
  const a = useAssistant()
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-gradient-to-br from-brand-600 to-violet-600 px-4 py-2.5 text-sm text-white shadow-brand">{msg.text}</p>
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-brand" aria-hidden="true">
        <Bot className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        {msg.kind === 'thinking' && (
          <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md bg-white px-4 py-3 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200" role="status">
            <span className="flex gap-1" aria-hidden="true">
              <span className="size-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-brand-500" />
            </span>
            {msg.text}
          </div>
        )}
        {msg.kind === 'text' && <Bubble icon={Bot} tone={msg.tone === 'warning' ? 'warning' : 'normal'}>{msg.text}</Bubble>}
        {msg.kind === 'draft' && <DraftAnswer headline={msg.headline} draft={msg.draft} context={msg.context} ms={msg.ms} latest={msg.id === latestDraftId} />}
        {msg.kind === 'error' && <ErrorAlert title={msg.title} error={msg.error} onRetry={msg.canRetry && a.canRetry ? a.retry : undefined} busy={a.busy} />}
      </div>
    </div>
  )
}

export function AssistantPage() {
  const a = useAssistant()
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const latestDraftId = [...a.messages].reverse().find((m) => m.role === 'assistant' && m.kind === 'draft')?.id ?? null

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [a.messages.length, a.editing])

  function submit(e: FormEvent) {
    e.preventDefault()
    a.send(text)
    setText('')
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="flex h-[calc(100vh-8.5rem)] min-h-[520px] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/60 shadow-card">
        <div className="flex-1 space-y-5 overflow-y-auto p-5" aria-live="polite">
          {a.messages.length === 0 && (
            <div className="mx-auto max-w-md py-10 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-brand">
                <Bot className="size-7" aria-hidden="true" />
              </span>
              <p className="mt-4 text-lg font-bold text-slate-900">Hi! I prepare grounded customer emails.</p>
              <p className="mt-1 text-sm text-slate-500">Name a customer (C001–C050) and I will look them up, explain the segment, recommend a strategy and draft the email. You decide whether to approve.</p>
            </div>
          )}
          {a.messages.map((m) => (
            <Message key={m.id} msg={m} latestDraftId={latestDraftId} />
          ))}
          <div ref={endRef} />
        </div>

        <div className="border-t border-slate-200 bg-white p-3.5">
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => a.send(q.text)}
                disabled={a.busy}
                className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-100 disabled:opacity-50"
              >
                {q.label}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Draft an email for C004 · Approve · Reject wrong tone"
              aria-label="Message the assistant"
              className="h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-sm placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
            />
            <Button type="submit" variant="primary" icon={Send} disabled={a.busy || text.trim() === ''} className="h-11">
              Send
            </Button>
          </form>
        </div>
      </section>

      <aside className="space-y-5">
        <Card title="Current draft" icon={Sparkles}>
          {a.current ? (
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2">
                <Badge tone={STATUS_DISPLAY[a.current.status].tone}>{STATUS_DISPLAY[a.current.status].label}</Badge>
                <span className="text-slate-500">rev {a.current.revision}</span>
              </p>
              <p className="text-slate-700">
                {a.currentContext?.customer.display_name} · <span className="font-mono text-xs">{a.current.customer_id}</span>
              </p>
              <p className="font-mono text-xs text-slate-400">{a.current.draft_id}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No draft yet.</p>
          )}
          <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
            <Button size="sm" variant="ghost" icon={Eraser} onClick={a.clear} disabled={a.busy}>
              Clear chat
            </Button>
            {a.canRetry && (
              <Button size="sm" icon={RotateCcw} onClick={a.retry}>
                Try again
              </Button>
            )}
          </div>
        </Card>
      </aside>
    </div>
  )
}
