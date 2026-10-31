/**
 * Panel 3: email preview and actions. Buttons per status follow FRONTEND_GUIDE.md:
 *   ready_for_review → Edit, Approve draft (default), Approve and mock-send (explicit), Reject
 *   blocked          → findings + support text; Edit (if a message exists) and Reject; no Approve
 *   final            → no actions; "Generate a new draft"
 * Nothing is shown as approved or sent until the backend response says so.
 */
import { Ban, Check, CheckCircle2, Clock, Mail, PencilLine, Send, Sparkles, X, XCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { buildApproveRequest, buildEditRequest, buildRejectRequest } from '../../api/endpoints'
import type { BusyAction, Failure } from '../../hooks/useReviewWorkflow'
import type { Context, Delivery, Draft, DraftStatus, ReviewRequest } from '../../types/contract'
import { formatDate, formatMoney, formatUtc, utcDate, yesNo } from '../../utils/format'
import { FINDING_LABELS, SEND_STATUS_LABELS, STATUS_DISPLAY } from '../../utils/labels'
import { getAllowedActions } from '../../utils/reviewRules'
import { Alert, ErrorAlert } from '../../ui/Alert'
import { Card, SectionLabel } from '../../ui/Card'
import { Badge, Button, PlainText } from '../../ui/primitives'

const STATUS_ICON: Record<DraftStatus, typeof Clock> = {
  ready_for_review: Clock,
  blocked: Ban,
  approved: CheckCircle2,
  rejected: XCircle,
  mock_sent: Send,
}

type Mode = 'idle' | 'approve' | 'edit' | 'reject'

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <SectionLabel>{title}</SectionLabel>
      <div className="text-sm text-slate-700">{children}</div>
    </div>
  )
}

/** Final check before approval: everything the contract requires on the approval screen. */
function ApproveConfirm({ draft, context, working, disabled, onApprove, onCancel }: {
  draft: Draft
  context: Context | null
  working: boolean
  disabled: boolean
  onApprove: (delivery: Delivery, feedback: string) => void
  onCancel: () => void
}) {
  const [feedback, setFeedback] = useState('')
  const offer = draft.selected_offer_id === null ? null : context?.offers.find((o) => o.offer_id === draft.selected_offer_id)
  const warnings = draft.validation.findings.filter((f) => f.severity === 'warning')
  const isReminder = draft.strategy?.objective === 'payment_reminder'

  return (
    <div className="space-y-4 rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
      <p className="font-semibold text-slate-900">Approve revision {draft.revision}?</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Offer">
          {draft.selected_offer_id === null ? 'No offer included.' : offer ? (
            <>
              <p className="font-medium">{offer.title}</p>
              <p className="text-xs">{offer.terms}</p>
              <p className="text-xs">Expires <strong>{utcDate(offer.expires_at)}</strong></p>
            </>
          ) : (
            <span className="text-amber-700">Offer not in the loaded context.</span>
          )}
        </Section>
        <Section title="Consent">
          {context ? (
            <p className="text-xs leading-relaxed">
              Email {yesNo(context.consent.email_allowed)} · Marketing {yesNo(context.consent.marketing_opt_in)} · Service {yesNo(context.consent.service_email_allowed)}
            </p>
          ) : (
            <span className="text-amber-700">Customer context not loaded.</span>
          )}
        </Section>
        {isReminder && context && (
          <Section title="Billing evidence">
            <p className="text-xs leading-relaxed">
              {formatMoney(context.billing.amount_due)} due {formatDate(context.billing.due_date)} · status {context.billing.status} · verified {formatUtc(context.billing.verified_at)} · dispute {yesNo(context.billing.dispute_open)}
            </p>
          </Section>
        )}
        <Section title="Validation">
          <p className="text-xs">
            {draft.validation.passed ? 'Passed' : 'Failed'} · {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </p>
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-800">
              {FINDING_LABELS[w.code]}: {w.message}
            </p>
          ))}
        </Section>
      </div>
      <p className="text-xs text-slate-500">Check that the message ends with the required disclaimer and the support path.</p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600">Feedback (optional)</span>
        <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={1000} rows={2} className={inputClass} placeholder="e.g. Verified reward terms and consent." />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Check} disabled={disabled} onClick={() => onApprove('draft_only', feedback)}>
          {working ? 'Approving…' : 'Approve draft'}
        </Button>
        <Button variant="secondary" icon={Send} disabled={disabled} onClick={() => onApprove('mock_email', feedback)}>
          Approve and mock-send
        </Button>
        <Button variant="ghost" disabled={disabled} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        <strong>Approve draft</strong> sends nothing. <strong>Approve and mock-send</strong> writes one mock outbox row and counts as a contact, so later drafts for
        this customer may be blocked by contact rules. Approval is final.
      </p>
    </div>
  )
}

function EditForm({ draft, working, disabled, refused, onSave, onCancel }: {
  draft: Draft
  working: boolean
  disabled: boolean
  refused: boolean
  onSave: (subject: string, body: string) => void
  onCancel: () => void
}) {
  const [subject, setSubject] = useState(draft.message?.subject ?? '')
  const [body, setBody] = useState(draft.message?.body ?? '')
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      <p className="font-semibold text-slate-900">Edit revision {draft.revision}</p>
      <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 ring-1 ring-inset ring-sky-600/15">
        Only formatting fixes pass in this version (line endings, spaces around the text). New claims, amounts, links or removing the disclaimer are refused. To change
        wording, generate a new draft.
      </p>
      {refused && (
        <p role="alert" className="text-sm font-semibold text-rose-700">
          The backend refused this edit; the draft is unchanged. Your text is kept below so you can fix it.
        </p>
      )}
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600">Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} className={inputClass} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600">Body (plain text)</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={9} className={`${inputClass} font-mono text-[13px] leading-relaxed`} />
      </label>
      <div className="flex gap-2">
        <Button variant="primary" icon={Check} disabled={disabled || subject.trim() === '' || body.trim() === ''} onClick={() => onSave(subject, body)}>
          {working ? 'Saving…' : 'Save edit'}
        </Button>
        <Button variant="ghost" disabled={disabled} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function RejectForm({ revision, working, disabled, onReject, onCancel }: {
  revision: number
  working: boolean
  disabled: boolean
  onReject: (feedback: string) => void
  onCancel: () => void
}) {
  const [feedback, setFeedback] = useState('')
  return (
    <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/50 p-4">
      <p className="font-semibold text-slate-900">Reject revision {revision}</p>
      <p className="text-xs text-slate-600">Rejecting closes this draft. Nothing is sent.</p>
      <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={1000} rows={2} className={inputClass} placeholder="Reason (optional), e.g. Wrong tone" />
      <div className="flex gap-2">
        <Button variant="danger" icon={X} disabled={disabled} onClick={() => onReject(feedback)} className="!bg-rose-600 !text-white hover:!bg-rose-700">
          {working ? 'Rejecting…' : 'Reject draft'}
        </Button>
        <Button variant="ghost" disabled={disabled} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function EmailPanel({ draft, context, stale, busy, failure, canRetry, onReview, onRetry, onDiscard, onGenerateNew, onRefresh }: {
  draft: Draft
  context: Context | null
  stale: boolean
  busy: BusyAction | null
  failure: Failure | null
  canRetry: boolean
  onReview: (body: ReviewRequest) => void
  onRetry: () => void
  onDiscard: () => void
  onGenerateNew: () => void
  onRefresh: () => void
}) {
  const [selected, setMode] = useState<Mode>('idle')
  const allowed = getAllowedActions(draft, stale)
  const mode: Mode = selected === 'approve' && !allowed.approve ? 'idle' : selected
  const status = STATUS_DISPLAY[draft.status]
  const StatusIcon = STATUS_ICON[draft.status]
  const disabled = busy !== null
  const working = busy === 'retry' || busy === mode
  const reviewFailure = failure?.scope === 'review' ? failure : null
  const blocks = draft.validation.findings.filter((f) => f.severity === 'block')

  return (
    <Card
      title="Email & actions"
      icon={Mail}
      actions={
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={disabled}>
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh'}
        </Button>
      }
      bodyClassName="space-y-5"
    >
      <div className="draft-summary flex flex-wrap items-center gap-3">
        <span className="summary-status">
          <Badge tone={status.tone} icon={StatusIcon} size="lg">
            {status.label}
          </Badge>
        </span>
        <span className="text-sm text-slate-500">Revision {draft.revision}</span>
        <span className="text-xs text-slate-400">· {SEND_STATUS_LABELS[draft.send_status]}</span>
      </div>

      {draft.status === 'blocked' && (
        <Alert tone="danger" title="This draft is blocked and cannot be approved.">
          <ul className="list-disc space-y-0.5 pl-5">
            {blocks.map((f, i) => (
              <li key={i}>
                <strong>{FINDING_LABELS[f.code]}:</strong> {f.message}
              </li>
            ))}
          </ul>
          {context && <p className="rounded-lg bg-white/70 px-3 py-2 text-slate-800">Support path: {context.billing.support_text}</p>}
        </Alert>
      )}

      {draft.message === null ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
          <Mail className="size-6 text-slate-400" aria-hidden="true" />
          No message was generated for this draft.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <dl className="divide-y divide-slate-100 bg-slate-50/80 text-sm">
            <div className="grid grid-cols-[64px_1fr_auto] items-center gap-3 px-4 py-2">
              <dt className="text-xs text-slate-500">From</dt>
              <dd className="text-slate-700">CodeVortex Customer Care</dd>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 ring-1 ring-slate-200">Plain text</span>
            </div>
            <div className="grid grid-cols-[64px_1fr] items-center gap-3 px-4 py-2">
              <dt className="text-xs text-slate-500">To</dt>
              <dd className="text-slate-700">{context?.customer.display_name ?? 'Customer'} <span className="text-xs text-slate-400">(address kept server-side)</span></dd>
            </div>
            <div className="grid grid-cols-[64px_1fr] items-start gap-3 px-4 py-2.5">
              <dt className="pt-0.5 text-xs text-slate-500">Subject</dt>
              <dd className="font-semibold text-slate-900">
                <PlainText>{draft.message.subject}</PlainText>
              </dd>
            </div>
          </dl>
          <div className="bg-white px-5 py-4 text-[14.5px] leading-7 text-slate-800">
            <PlainText>{draft.message.body}</PlainText>
          </div>
        </div>
      )}

      {allowed.isFinal ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
          <p className="text-sm text-slate-700">
            {draft.status === 'mock_sent' && <>Mock sent by <strong>{draft.approved_by}</strong> at {formatUtc(draft.approved_at)} · delivery <span className="font-mono">{draft.delivery_id}</span></>}
            {draft.status === 'approved' && <>Approved as draft only by <strong>{draft.approved_by}</strong> at {formatUtc(draft.approved_at)}. Nothing was sent.</>}
            {draft.status === 'rejected' && <>Rejected. Nothing was sent.{draft.feedback && <> Reason: “{draft.feedback}”</>}</>}
          </p>
          <Button variant="primary" icon={Sparkles} onClick={onGenerateNew} disabled={disabled}>
            Generate a new draft
          </Button>
        </div>
      ) : (
        <>
          {mode === 'idle' && (
            <div className="review-actions flex flex-wrap gap-2">
              <Button icon={PencilLine} onClick={() => setMode('edit')} disabled={disabled || !allowed.edit} title={allowed.editReason ?? undefined}>
                Edit
              </Button>
              <Button variant="primary" icon={Check} onClick={() => setMode('approve')} disabled={disabled || !allowed.approve} title={allowed.approveReason ?? undefined}>
                Approve…
              </Button>
              <Button variant="danger" icon={X} onClick={() => setMode('reject')} disabled={disabled || !allowed.reject}>
                Reject…
              </Button>
              {allowed.approveReason && <p className="w-full text-xs text-slate-500">{allowed.approveReason}</p>}
            </div>
          )}
          {mode === 'approve' && (
            <ApproveConfirm
              draft={draft}
              context={context}
              working={working}
              disabled={disabled}
              onApprove={(delivery, feedback) => onReview(buildApproveRequest(draft.revision, delivery, feedback))}
              onCancel={() => setMode('idle')}
            />
          )}
          {mode === 'edit' && draft.message && (
            <EditForm
              draft={draft}
              working={working}
              disabled={disabled}
              refused={reviewFailure?.decision === 'edit' && reviewFailure.error.code === 'REVIEW_BLOCKED'}
              onSave={(subject, body) => onReview(buildEditRequest(draft.revision, subject, body))}
              onCancel={() => {
                setMode('idle')
                if (reviewFailure?.decision === 'edit') onDiscard()
              }}
            />
          )}
          {mode === 'reject' && (
            <RejectForm
              revision={draft.revision}
              working={working}
              disabled={disabled}
              onReject={(feedback) => onReview(buildRejectRequest(draft.revision, feedback))}
              onCancel={() => setMode('idle')}
            />
          )}
        </>
      )}

      {reviewFailure && (
        <ErrorAlert
          title={`Could not ${reviewFailure.decision ?? 'review'} the draft`}
          error={reviewFailure.error}
          hint={reviewFailure.hint}
          onRetry={canRetry ? onRetry : undefined}
          retryReadyAt={reviewFailure.retryReadyAt}
          onDismiss={onDiscard}
          busy={disabled}
        />
      )}

      <p className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
        <span className="font-mono">{draft.draft_id}</span> · model <span className="font-mono">{draft.versions.model_version}</span> · prompt{' '}
        <span className="font-mono">{draft.versions.prompt_version}</span> · policy <span className="font-mono">{draft.versions.policy_version}</span> · request{' '}
        <span className="font-mono">{draft.request_id}</span>
      </p>
    </Card>
  )
}
