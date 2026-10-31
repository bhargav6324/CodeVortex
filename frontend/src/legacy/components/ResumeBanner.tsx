import type { Resumable } from '../../hooks/useReviewWorkflow'

/** After a page reload: offer to restore the draft and any action whose outcome is unknown. */
export function ResumeBanner({ resumable, hasToken, busy, onResume, onDismiss }: {
  resumable: Resumable
  hasToken: boolean
  busy: boolean
  onResume: () => void
  onDismiss: () => void
}) {
  const action = resumable.pending
  const actionText =
    action === null
      ? null
      : action.kind === 'create'
        ? 'Your last "generate draft" request may not have finished.'
        : `Your last "${action.body.decision}" action may not have finished.`

  return (
    <div className="banner banner-info" role="status">
      <div className="banner-body">
        <p className="banner-title">Continue where you left off?</p>
        <p>
          You were reviewing{' '}
          {resumable.draftId ? <span className="mono">{resumable.draftId}</span> : 'a draft'} for customer{' '}
          <span className="mono">{resumable.customerId}</span>.
          {actionText && ` ${actionText}`}
        </p>
        {!hasToken && <p className="small">Paste the reviewer token first. It is not kept after a reload.</p>}
        <div className="banner-actions">
          <button type="button" className="btn-primary" onClick={onResume} disabled={!hasToken || busy}>
            Resume
          </button>
          <button type="button" onClick={onDismiss} disabled={busy}>
            Start fresh
          </button>
        </div>
      </div>
    </div>
  )
}
