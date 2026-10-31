import type { Segment } from '../../../types/contract'
import { formatPercent } from '../../../utils/format'
import { REASON_LABELS, SEGMENT_LABELS } from '../../../utils/labels'
import { Card, Code, EvidenceTable } from '../ui'

/** Every segment the backend returned, in the backend's order, with its exact evidence. */
export function SegmentList({ segments }: { segments: Segment[] }) {
  return (
    <Card title={`Segments · ${segments.length}`} icon="layers">
      {segments.length === 0 ? (
        <p className="muted small">No segment matched for this customer.</p>
      ) : (
        <div className="segment-list">
          {segments.map((s) => (
            <article key={s.code} className={`segment segment-${s.code}`}>
              <div className="segment-head">
                <h3>{SEGMENT_LABELS[s.code]}</h3>
                <Code>{s.code}</Code>
              </div>
              <div className="confidence" title="Rule confidence (not an AI probability)">
                <span className="small muted">Rule confidence</span>
                <span className="meter" aria-hidden="true">
                  <span className="meter-fill" style={{ width: formatPercent(s.confidence) }} />
                </span>
                <span className="small">{formatPercent(s.confidence)}</span>
              </div>
              <ul className="chips" aria-label="Reason codes">
                {s.reason_codes.map((r) => (
                  <li key={r} className="chip">
                    {REASON_LABELS[r]} <Code>{r}</Code>
                  </li>
                ))}
              </ul>
              <EvidenceTable evidence={s.evidence} />
            </article>
          ))}
        </div>
      )}
    </Card>
  )
}
