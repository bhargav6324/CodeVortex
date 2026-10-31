/**
 * LEGACY reviewer screen (works against the real backend today). Kept at /legacy until its
 * features are rebuilt as the Message Studio and Approvals pages of the new LoyaltyAI app.
 *
 * Reviewer page layout. State and API calls live in useReviewWorkflow; components only
 * display what they are given.
 */
import { useEffect, useRef, useState } from 'react'
import './legacy.css'
import { setAuthToken } from '../api/client'
import { USE_MOCKS } from '../api/config'
import { AppHeader } from './components/AppHeader'
import { ContextPanel } from './components/ContextPanel'
import { CustomerPicker } from './components/CustomerPicker'
import { DraftView } from './components/draft/DraftView'
import { ErrorBanner } from './components/ErrorBanner'
import { NoticeBanner } from './components/NoticeBanner'
import { ResumeBanner } from './components/ResumeBanner'
import { ReviewPanel } from './components/review/ReviewPanel'
import { GettingStarted } from './components/GettingStarted'
import { Icon } from './components/icons'
import { Spinner } from './components/ui'
import { customersFor } from '../config/customers'
import { AuditTrailCard } from './components/extensions/AuditTrailCard'
import { OfferEligibilityCard } from './components/extensions/OfferEligibilityCard'
import { OutboxCard } from './components/extensions/OutboxCard'
import { RatingCard } from './components/extensions/RatingCard'
import { useBackendHealth } from '../hooks/useBackendHealth'
import { useDraftDetails } from '../hooks/useDraftDetails'
import { useReviewWorkflow } from '../hooks/useReviewWorkflow'

const customers = customersFor(USE_MOCKS)

export default function App() {
  const [token, setToken] = useState('')
  const tokenInputRef = useRef<HTMLInputElement>(null)
  const wf = useReviewWorkflow(customers[0].id)
  const health = useBackendHealth()
  // Proposed v1.1.0 panels appear only when the backend reports contract 1.1.0.
  const extra = useDraftDetails(wf.draft, health.extensions)

  const tokenSet = token.trim() !== ''
  const { context, draft, failure, busy } = wf
  const contextMatches = context !== null && context.customer.customer_id === wf.customerId
  const createFailure = failure !== null && failure.scope !== 'review' ? failure : null

  // After a 401, put the cursor in the token box so the reviewer can paste a new one.
  const unauthorized =
    failure?.error.code === 'UNAUTHORIZED' ||
    wf.contextError?.code === 'UNAUTHORIZED' ||
    extra.ratingFailure?.error.code === 'UNAUTHORIZED'
  useEffect(() => {
    if (unauthorized) tokenInputRef.current?.focus()
  }, [unauthorized])

  function handleTokenChange(value: string) {
    setToken(value)
    setAuthToken(value)
  }

  async function resetMocks() {
    const { resetMockDb } = await import('../mocks/db')
    resetMockDb()
    wf.resetAll()
  }

  return (
    <div className="legacy-app app">
      <AppHeader
        token={token}
        onTokenChange={handleTokenChange}
        onResetMocks={USE_MOCKS ? resetMocks : undefined}
        tokenInputRef={tokenInputRef}
        health={health}
      />

      <main className="layout">
        <aside className="sidebar" aria-label="Customer context">
          <CustomerPicker
            customers={customers}
            value={wf.customerId}
            onChange={(id) => wf.selectCustomer(id, tokenSet)}
            onLoad={() => void wf.loadContext(wf.customerId)}
            disabled={busy !== null || wf.contextLoading}
            hasToken={tokenSet}
          />
          {wf.contextLoading && <Spinner label="Loading customer context…" />}
          {wf.contextError && (
            <ErrorBanner title="Could not load customer" error={wf.contextError} onDismiss={wf.clearContextError} />
          )}
          {contextMatches && <ContextPanel context={context} />}
        </aside>

        <section className="workspace" aria-label="Draft review">
          {wf.resumable && (
            <ResumeBanner
              resumable={wf.resumable}
              hasToken={tokenSet}
              busy={busy !== null}
              onResume={() => void wf.resume()}
              onDismiss={wf.dismissResume}
            />
          )}

          {(contextMatches || draft) && (
          <div className="generate-bar card">
            <div>
              <p className="generate-title">
                {contextMatches ? `Draft for ${context.customer.display_name}` : 'Draft'}
              </p>
              <p className="muted small">Generating creates a draft for review. It never approves or sends anything.</p>
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void wf.generate()}
              disabled={!contextMatches || busy !== null}
            >
              <Icon name="sparkles" size={16} />
              {busy === 'create' ? 'Generating…' : draft ? 'Generate new draft' : 'Generate draft'}
            </button>
          </div>
          )}

          {busy === 'create' && <Spinner label="Generating draft. This can take up to 30 seconds…" />}
          {busy === 'retry' && createFailure && <Spinner label="Retrying with the same request key…" />}
          {wf.notice && <NoticeBanner notice={wf.notice} onDismiss={wf.dismissNotice} />}
          {createFailure && (
            <ErrorBanner
              title={createFailure.scope === 'create' ? 'Draft generation failed' : 'Could not load the draft'}
              error={createFailure.error}
              hint={createFailure.hint}
              retry={
                wf.hasPendingRetry
                  ? { onRetry: () => void wf.retry(), readyAt: createFailure.retryReadyAt, disabled: busy !== null }
                  : undefined
              }
              onDismiss={wf.discardFailure}
            />
          )}

          {draft ? (
            <DraftView
              draft={draft}
              context={contextMatches ? context : null}
              onRefresh={() => void wf.refresh()}
              refreshing={busy === 'refresh'}
              review={
                <ReviewPanel
                  key={`${draft.draft_id}:${draft.revision}`}
                  draft={draft}
                  context={contextMatches ? context : null}
                  stale={wf.isStale}
                  busy={busy}
                  failure={failure}
                  canRetry={wf.hasPendingRetry}
                  onReview={(body) => void wf.review(body)}
                  onRetry={() => void wf.retry()}
                  onDiscard={wf.discardFailure}
                />
              }
              afterReview={
                health.extensions && (
                  <RatingCard
                    key={`${draft.draft_id}:${draft.revision}:${extra.details?.ratings.length ?? 0}`}
                    draft={draft}
                    ratings={extra.details?.ratings ?? []}
                    busy={extra.ratingBusy}
                    failure={extra.ratingFailure}
                    saved={extra.ratingSaved}
                    onSubmit={extra.rate}
                    onRetry={extra.retryRating}
                    onDismiss={extra.dismissRatingFailure}
                  />
                )
              }
              afterOffer={
                health.extensions &&
                extra.details && (
                  <OfferEligibilityCard
                    eligibility={extra.details.eligibility}
                    offers={contextMatches ? context.offers : []}
                    selectedOfferId={draft.selected_offer_id}
                  />
                )
              }
              footer={
                health.extensions && (
                  <>
                    {extra.error && (
                      <ErrorBanner title="Could not load draft details" error={extra.error} onDismiss={extra.reload} />
                    )}
                    {extra.details && <OutboxCard entry={extra.details.outbox} draftStatus={draft.status} />}
                    {extra.details && <AuditTrailCard events={extra.details.audit} />}
                  </>
                )
              }
            />
          ) : (
            busy !== 'create' && (
              <GettingStarted
                tokenSet={tokenSet}
                customerLoaded={contextMatches}
                customerName={contextMatches ? context.customer.display_name : null}
                onFocusToken={() => tokenInputRef.current?.focus()}
              />
            )
          )}
        </section>
      </main>
    </div>
  )
}
