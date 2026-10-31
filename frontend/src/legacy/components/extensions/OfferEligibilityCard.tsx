import type { Eligibility, Offer } from '../../../types/contract'
import { ELIGIBILITY_REASON_LABELS } from '../../../utils/labels'
import { Badge, Card, Code } from '../ui'

/**
 * Proposed v1.1.0 (FR-05): why each approved offer was or was not eligible.
 * Results come from the backend's deterministic plan; React only displays them.
 */
export function OfferEligibilityCard({ eligibility, offers, selectedOfferId }: {
  eligibility: Eligibility[]
  offers: Offer[]
  selectedOfferId: string | null
}) {
  return (
    <Card title={`Offer eligibility · ${eligibility.length}`} icon="gift">
      {eligibility.length === 0 ? (
        <p className="muted small">
          No eligibility data for this draft. Either no offers were evaluated, or the draft was created before the
          backend started storing eligibility.
        </p>
      ) : (
        <ul className="plain-list">
          {eligibility.map((e) => {
            const offer = offers.find((o) => o.offer_id === e.offer_id)
            return (
              <li key={e.offer_id} className="eligibility-row">
                <span className="eligibility-head">
                  <strong>{offer?.title ?? e.offer_id}</strong>
                  <Code>{e.offer_id}</Code>
                  <Badge tone={e.eligible ? 'success' : 'neutral'}>{e.eligible ? 'Eligible' : 'Not eligible'}</Badge>
                  {e.offer_id === selectedOfferId && <Badge tone="info">Selected</Badge>}
                </span>
                {!e.eligible && (
                  <ul className="chips" aria-label="Reasons">
                    {e.reason_codes.map((r) => (
                      <li key={r} className="chip">
                        {ELIGIBILITY_REASON_LABELS[r]} <Code>{r}</Code>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
