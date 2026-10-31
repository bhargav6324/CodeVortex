import type { Offer } from '../../../types/contract'
import { formatMoney, formatUtc, utcDate } from '../../../utils/format'
import { Card, Field, Fields } from '../ui'

/**
 * The draft only carries `selected_offer_id`; the offer's terms and expiry come from the
 * loaded customer Context. Terms are shown exactly as approved.
 */
export function OfferCard({ selectedOfferId, offers }: { selectedOfferId: string | null; offers: Offer[] }) {
  if (selectedOfferId === null) {
    return (
      <Card title="Offer" icon="gift">
        <p className="muted small">No offer is included in this draft.</p>
      </Card>
    )
  }

  const offer = offers.find((o) => o.offer_id === selectedOfferId)
  if (offer === undefined) {
    return (
      <Card title="Offer" icon="gift">
        <p className="text-warning small">
          Offer <span className="mono">{selectedOfferId}</span> is not in the loaded customer context. Reload the
          customer before reviewing this offer.
        </p>
      </Card>
    )
  }

  return (
    <Card title="Offer" icon="gift">
      <p className="offer-title">{offer.title}</p>
      <p className="plain-text offer-terms">{offer.terms}</p>
      <Fields>
        <Field label="Offer ID" value={offer.offer_id} mono />
        <Field label="Value" value={formatMoney(offer.value)} />
        <Field label="Expires" value={`${utcDate(offer.expires_at)} (${formatUtc(offer.expires_at)})`} />
        <Field label="Valid from" value={formatUtc(offer.valid_from)} />
        <Field label="Terms version" value={offer.terms_version} mono />
        <Field label="Channel" value={offer.channel} mono />
      </Fields>
    </Card>
  )
}
