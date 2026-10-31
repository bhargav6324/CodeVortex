import type { Notice } from '../../hooks/useReviewWorkflow'

/** Success / info / warning message built from the Draft the backend returned. */
export function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <div className={`banner banner-${notice.tone}`} role="status" aria-live="polite">
      <div className="banner-body">
        <p className="banner-title">{notice.title}</p>
        {notice.text && <p>{notice.text}</p>}
      </div>
      <button type="button" className="btn-ghost" onClick={onDismiss} aria-label="Dismiss message">
        ✕
      </button>
    </div>
  )
}
