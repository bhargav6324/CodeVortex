import type { DraftStatus } from '../../../types/contract'
import type { OutboxEntry } from '../../../types/contractV11'
import { formatUtc } from '../../../utils/format'
import { Card, Field, Fields } from '../ui'

/**
 * Proposed v1.1.0 (FR-10): the single mock outbox row written on "Approve and mock-send".
 * Also flags the inconsistent case where the draft says mock_sent but no row exists.
 */
export function OutboxCard({ entry, draftStatus }: { entry: OutboxEntry | null; draftStatus: DraftStatus }) {
  if (entry === null) {
    if (draftStatus !== 'mock_sent') return null
    return (
      <Card title="Mock outbox" icon="inbox">
        <p className="small text-danger">
          The draft is marked as mock sent, but the backend returned no outbox row. Report this to the backend team.
        </p>
      </Card>
    )
  }
  return (
    <Card title="Mock outbox entry" icon="inbox">
      <p className="small muted">Written by the mock email adapter. No real email was sent.</p>
      <Fields>
        <Field label="Delivery ID" value={entry.delivery_id} mono />
        <Field label="Delivered" value={formatUtc(entry.delivered_at)} />
        <Field label="Campaign key" value={entry.campaign_key} mono />
        <Field label="Channel" value={`${entry.channel} (${entry.delivery})`} mono />
        <Field label="Content hash" value={entry.content_hash} mono />
      </Fields>
      <div className="email compact">
        <p className="plain-text email-subject-line">{entry.subject}</p>
        <div className="email-body plain-text">{entry.body}</div>
      </div>
    </Card>
  )
}
