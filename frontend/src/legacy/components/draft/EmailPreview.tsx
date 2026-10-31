import type { Evidence, Message } from '../../../types/contract'
import { Icon } from '../icons'
import { Card, EvidenceTable } from '../ui'

/**
 * The generated email, framed like an email client but rendered as PLAIN TEXT.
 * React escapes the text and CSS keeps line breaks. Never render model output as HTML.
 */
export function EmailPreview({ message, evidence, recipientName }: {
  message: Message | null
  evidence: Evidence[]
  recipientName: string | null
}) {
  return (
    <Card title="Email draft" icon="mail" className="email-card">
      {message === null ? (
        <div className="email-empty">
          <Icon name="mail" size={22} />
          <p>No message was generated for this draft.</p>
        </div>
      ) : (
        <div className="email">
          <div className="email-meta">
            <div className="email-meta-row">
              <span className="email-meta-label">From</span>
              <span>CodeVortex Customer Care</span>
              <span className="badge badge-neutral">Plain text</span>
            </div>
            <div className="email-meta-row">
              <span className="email-meta-label">To</span>
              <span>{recipientName ?? 'Customer'}</span>
              <span className="muted small">address kept server-side</span>
            </div>
            <div className="email-meta-row email-subject">
              <span className="email-meta-label">Subject</span>
              <p className="plain-text">{message.subject}</p>
            </div>
          </div>
          <div className="email-body plain-text">{message.body}</div>
        </div>
      )}
      <details className="evidence-details" open>
        <summary>
          Evidence behind this draft <span className="count">{evidence.length}</span>
        </summary>
        <EvidenceTable evidence={evidence} emptyText="No draft-level evidence returned." />
      </details>
    </Card>
  )
}
