import type { Finding } from '../../../types/contract'
import { FINDING_LABELS } from '../../../utils/labels'

/** Explains why the backend refused this draft and shows the approved support path. */
export function BlockedBanner({ findings, supportText }: { findings: Finding[]; supportText: string | null }) {
  const blocks = findings.filter((f) => f.severity === 'block')
  return (
    <div className="banner banner-danger" role="alert">
      <div className="banner-body">
        <p className="banner-title">This draft is blocked and cannot be approved or sent.</p>
        {blocks.length > 0 ? (
          <ul className="detail-list">
            {blocks.map((f, i) => (
              <li key={i}>
                <strong>{FINDING_LABELS[f.code]}</strong>: {f.message}
              </li>
            ))}
          </ul>
        ) : (
          <p>The backend returned no block findings. Refresh the draft or contact the backend team.</p>
        )}
        {supportText && (
          <p className="support-path">
            <span className="small muted">Support path</span>
            <br />
            {supportText}
          </p>
        )}
      </div>
    </div>
  )
}
