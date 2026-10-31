import type { Draft, DraftStatus } from '../../../types/contract'
import { formatUtc } from '../../../utils/format'
import { OBJECTIVE_LABELS, SEND_STATUS_LABELS, STATUS_DISPLAY, TONE_LABELS } from '../../../utils/labels'
import { Icon, type IconName } from '../icons'
import { Badge, Field, Fields } from '../ui'

const STATUS_ICON: Record<DraftStatus, IconName> = {
  ready_for_review: 'clock',
  blocked: 'ban',
  approved: 'check',
  rejected: 'x',
  mock_sent: 'send',
}

/** Draft status hero: what state it is in, what the strategy is, and its identifiers. */
export function DraftSummary({ draft, onRefresh, refreshing }: {
  draft: Draft
  onRefresh: () => void
  refreshing: boolean
}) {
  const status = STATUS_DISPLAY[draft.status]
  return (
    <section className={`card draft-summary hero hero-${status.tone}`}>
      <div className="hero-top">
        <div className="summary-status">
          <Badge tone={status.tone} icon={STATUS_ICON[draft.status]}>
            {status.label}
          </Badge>
          <span className="hero-revision">Revision {draft.revision}</span>
        </div>
        <button type="button" className="btn-ghost small" onClick={onRefresh} disabled={refreshing}>
          <Icon name="refresh" size={14} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="hero-chips">
        {draft.strategy ? (
          <>
            <span className="chip chip-strong">
              <Icon name="target" size={13} />
              {OBJECTIVE_LABELS[draft.strategy.objective]}
            </span>
            <span className="chip">Tone: {TONE_LABELS[draft.strategy.tone]}</span>
            <span className="chip">
              Template <span className="mono">{draft.strategy.template_id}</span>
            </span>
          </>
        ) : (
          <span className="chip">No strategy selected</span>
        )}
        <span className="chip">{SEND_STATUS_LABELS[draft.send_status]}</span>
      </div>

      <Fields variant="grid">
        <Field label="Draft ID" value={draft.draft_id} mono />
        <Field label="Campaign key" value={draft.campaign_key} mono />
        <Field label="Created" value={formatUtc(draft.created_at)} />
        <Field label="Updated" value={formatUtc(draft.updated_at)} />
        <Field label="Generation request" value={draft.request_id} mono />
        {draft.approved_by !== null && <Field label="Approved by" value={draft.approved_by} mono />}
        {draft.approved_at !== null && <Field label="Approved at" value={formatUtc(draft.approved_at)} />}
        {draft.delivery_id !== null && <Field label="Mock delivery ID" value={draft.delivery_id} mono />}
      </Fields>

      {draft.feedback !== null && (
        <div className="feedback">
          <span className="small muted">Reviewer feedback</span>
          <p className="plain-text">{draft.feedback}</p>
        </div>
      )}
    </section>
  )
}
