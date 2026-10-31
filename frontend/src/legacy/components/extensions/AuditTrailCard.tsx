import type { AuditEvent } from '../../../types/contractV11'
import { formatUtc } from '../../../utils/format'
import { AUDIT_EVENT_LABELS } from '../../../utils/labels'
import { Card, Code } from '../ui'

/** Proposed v1.1.0 (FR-09): the backend's audit trail for this draft, oldest first. */
export function AuditTrailCard({ events }: { events: AuditEvent[] }) {
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at) || a.event_id.localeCompare(b.event_id))
  return (
    <Card title={`Audit trail · ${events.length}`} icon="history">
      {ordered.length === 0 ? (
        <p className="muted small">No audit events recorded.</p>
      ) : (
        <ol className="timeline">
          {ordered.map((e) => (
            <li key={e.event_id} className={`timeline-item event-${e.event_type}`}>
              <div className="timeline-head">
                <strong>{AUDIT_EVENT_LABELS[e.event_type]}</strong>
                <span className="small muted">
                  rev {e.revision} · {formatUtc(e.at)} · <span className="mono">{e.actor_id}</span>
                </span>
              </div>
              <p className="small plain-text">{e.summary}</p>
              {e.evidence_fields.length > 0 && (
                <p className="small muted">
                  Evidence fields:{' '}
                  {e.evidence_fields.map((f) => (
                    <Code key={f}>{f}</Code>
                  ))}
                </p>
              )}
              <p className="small muted">
                request_id <span className="mono">{e.request_id}</span>
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
