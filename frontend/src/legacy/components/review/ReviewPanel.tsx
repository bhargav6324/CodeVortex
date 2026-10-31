import { useState } from 'react'
import { buildApproveRequest, buildEditRequest, buildRejectRequest } from '../../../api/endpoints'
import type { BusyAction, Failure } from '../../../hooks/useReviewWorkflow'
import type { Context, Draft, ReviewRequest } from '../../../types/contract'
import { formatUtc } from '../../../utils/format'
import { getAllowedActions } from '../../../utils/reviewRules'
import { ErrorBanner } from '../ErrorBanner'
import { Icon } from '../icons'
import { Card } from '../ui'
import { ApprovePanel } from './ApprovePanel'
import { EditPanel } from './EditPanel'
import { RejectPanel } from './RejectPanel'

type Mode = 'idle' | 'edit' | 'approve' | 'reject'

/**
 * Review actions for one draft revision. Render it with key={draft_id:revision} so the
 * open panel closes whenever the backend returns a new revision.
 */
export function ReviewPanel({ draft, context, stale, busy, failure, canRetry, onReview, onRetry, onDiscard }: {
  draft: Draft
  context: Context | null
  stale: boolean
  busy: BusyAction | null
  failure: Failure | null
  canRetry: boolean
  onReview: (body: ReviewRequest) => void
  onRetry: () => void
  onDiscard: () => void
}) {
  const [selectedMode, setMode] = useState<Mode>('idle')
  const allowed = getAllowedActions(draft, stale)
  // Close the approve panel as soon as approval stops being allowed (e.g. stale data after a 409).
  const mode: Mode = selectedMode === 'approve' && !allowed.approve ? 'idle' : selectedMode
  const reviewFailure = failure?.scope === 'review' ? failure : null
  const disabled = busy !== null
  const working = busy === 'retry' || busy === mode

  const failureBanner = reviewFailure && (
    <ErrorBanner
      title={`Could not ${reviewFailure.decision ?? 'review'} the draft`}
      error={reviewFailure.error}
      hint={reviewFailure.hint}
      retry={canRetry ? { onRetry, readyAt: reviewFailure.retryReadyAt, disabled } : undefined}
      onDismiss={onDiscard}
    />
  )

  if (allowed.isFinal) {
    return (
      <Card title="Review" icon="shieldCheck">
        <p>{finalText(draft)}</p>
        <p className="small muted">This draft is final. Generate a new draft to prepare another message.</p>
        {failureBanner}
      </Card>
    )
  }

  return (
    <Card title="Review" icon="shieldCheck" className="review-card">
      <p className="small muted">
        Reviewing revision {draft.revision}. Approval applies to exactly this revision.
      </p>

      {mode === 'idle' && (
        <div className="review-actions">
          <div className="action">
            <button type="button" onClick={() => setMode('edit')} disabled={disabled || !allowed.edit}>
              <Icon name="edit" size={15} />
              Edit
            </button>
            {allowed.editReason && <span className="small muted">{allowed.editReason}</span>}
          </div>
          <div className="action">
            <button type="button" className="btn-primary" onClick={() => setMode('approve')} disabled={disabled || !allowed.approve}>
              <Icon name="check" size={15} />
              Approve…
            </button>
            {allowed.approveReason && <span className="small muted">{allowed.approveReason}</span>}
          </div>
          <div className="action">
            <button type="button" className="btn-danger-outline" onClick={() => setMode('reject')} disabled={disabled || !allowed.reject}>
              <Icon name="x" size={15} />
              Reject…
            </button>
          </div>
        </div>
      )}

      {mode === 'edit' && draft.message && (
        <EditPanel
          message={draft.message}
          revision={draft.revision}
          working={working}
          disabled={disabled}
          refused={reviewFailure?.decision === 'edit' && reviewFailure.error.code === 'REVIEW_BLOCKED'}
          onSubmit={(subject, body) => onReview(buildEditRequest(draft.revision, subject, body))}
          onCancel={() => {
            setMode('idle')
            if (reviewFailure?.decision === 'edit') onDiscard()
          }}
        />
      )}

      {mode === 'approve' && (
        <ApprovePanel
          draft={draft}
          context={context}
          working={working}
          disabled={disabled || !allowed.approve}
          onSubmit={(delivery, feedback) => onReview(buildApproveRequest(draft.revision, delivery, feedback))}
          onCancel={() => setMode('idle')}
        />
      )}

      {mode === 'reject' && (
        <RejectPanel
          revision={draft.revision}
          working={working}
          disabled={disabled}
          onSubmit={(feedback) => onReview(buildRejectRequest(draft.revision, feedback))}
          onCancel={() => setMode('idle')}
        />
      )}

      {failureBanner}
    </Card>
  )
}

function finalText(draft: Draft): string {
  switch (draft.status) {
    case 'mock_sent':
      return `Mock sent by ${draft.approved_by ?? 'unknown'} at ${formatUtc(draft.approved_at)}. Delivery ID ${draft.delivery_id ?? 'unknown'}.`
    case 'approved':
      return `Approved as draft only by ${draft.approved_by ?? 'unknown'} at ${formatUtc(draft.approved_at)}. Nothing was sent.`
    case 'rejected':
      return 'Rejected. Nothing was sent.'
    default:
      return ''
  }
}
