import type { ReactNode } from 'react'
import type { Context, Draft } from '../../../types/contract'
import { BlockedBanner } from './BlockedBanner'
import { DraftSummary } from './DraftSummary'
import { EmailPreview } from './EmailPreview'
import { OfferCard } from './OfferCard'
import { SegmentList } from './SegmentList'
import { StrategyCard } from './StrategyCard'
import { ValidationList } from './ValidationList'
import { VersionsCard } from './VersionsCard'

/**
 * Everything the reviewer needs to judge one draft. Decisions come from the Draft;
 * supporting facts (offer terms, support text) come from the customer Context.
 */
export function DraftView({ draft, context, onRefresh, refreshing, review, afterReview, afterOffer, footer }: {
  draft: Draft
  context: Context | null
  onRefresh: () => void
  refreshing: boolean
  /** The review actions panel, placed right under the status. */
  review: ReactNode
  /** Optional extra panels (proposed v1.1.0 features). */
  afterReview?: ReactNode
  afterOffer?: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="stack">
      <DraftSummary draft={draft} onRefresh={onRefresh} refreshing={refreshing} />
      {draft.status === 'blocked' && (
        <BlockedBanner findings={draft.validation.findings} supportText={context?.billing.support_text ?? null} />
      )}
      {review}
      {afterReview}
      <div className="grid-2">
        <SegmentList segments={draft.segments} />
        <div className="stack">
          <StrategyCard strategy={draft.strategy} />
          <OfferCard selectedOfferId={draft.selected_offer_id} offers={context?.offers ?? []} />
          {afterOffer}
        </div>
      </div>
      <EmailPreview message={draft.message} evidence={draft.evidence} recipientName={context?.customer.display_name ?? null} />
      <div className="grid-2">
        <ValidationList validation={draft.validation} />
        <VersionsCard versions={draft.versions} />
      </div>
      {footer}
    </div>
  )
}
