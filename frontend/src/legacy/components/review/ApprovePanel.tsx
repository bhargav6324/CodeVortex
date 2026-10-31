import { useState } from 'react'
import type { Context, Delivery, Draft } from '../../../types/contract'
import { formatDate, formatMoney, formatUtc, utcDate, yesNo } from '../../../utils/format'
import { FINDING_LABELS } from '../../../utils/labels'
import { Field, Fields } from '../ui'

/**
 * Final check before approval. Shows everything the contract requires on the approval
 * screen: current message, offer terms and expiry, billing evidence for reminders,
 * disclaimer, consent summary, validation and the delivery choice (default draft_only).
 */
export function ApprovePanel({ draft, context, working, disabled, onSubmit, onCancel }: {
  draft: Draft
  context: Context | null
  working: boolean
  disabled: boolean
  onSubmit: (delivery: Delivery, feedback: string) => void
  onCancel: () => void
}) {
  const [delivery, setDelivery] = useState<Delivery>('draft_only')
  const [feedback, setFeedback] = useState('')

  const offer = draft.selected_offer_id === null ? null : context?.offers.find((o) => o.offer_id === draft.selected_offer_id)
  const isReminder = draft.strategy?.objective === 'payment_reminder'
  const warnings = draft.validation.findings.filter((f) => f.severity === 'warning')
  const primaryLabel = delivery === 'mock_email' ? 'Approve and mock-send' : 'Approve draft'

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(delivery, feedback)
      }}
    >
      <h3 className="panel-title">Approve revision {draft.revision}</h3>

      <div className="approve-section">
        <h4>Message</h4>
        {draft.message ? (
          <div className="email compact">
            <p className="plain-text email-subject-line">{draft.message.subject}</p>
            <div className="email-body plain-text">{draft.message.body}</div>
          </div>
        ) : (
          <p className="muted small">No message.</p>
        )}
        <p className="small muted">Check that the message ends with the required disclaimer and the support path.</p>
      </div>

      <div className="approve-grid">
        <div className="approve-section">
          <h4>Offer</h4>
          {draft.selected_offer_id === null ? (
            <p className="small">No offer included.</p>
          ) : offer ? (
            <>
              <p className="small">
                <strong>{offer.title}</strong> <span className="mono">{offer.offer_id}</span>
              </p>
              <p className="small plain-text">{offer.terms}</p>
              <p className="small">
                Expires <strong>{utcDate(offer.expires_at)}</strong> ({formatUtc(offer.expires_at)})
              </p>
            </>
          ) : (
            <p className="small text-warning">
              Offer {draft.selected_offer_id} is not in the loaded customer context. Reload the customer before approving.
            </p>
          )}
        </div>

        <div className="approve-section">
          <h4>Consent</h4>
          {context ? (
            <Fields>
              <Field label="Email allowed" value={yesNo(context.consent.email_allowed)} tone={context.consent.email_allowed ? undefined : 'danger'} />
              <Field label="Marketing opt-in" value={yesNo(context.consent.marketing_opt_in)} tone={context.consent.marketing_opt_in ? undefined : 'danger'} />
              <Field label="Service emails" value={yesNo(context.consent.service_email_allowed)} tone={context.consent.service_email_allowed ? undefined : 'danger'} />
            </Fields>
          ) : (
            <p className="small text-warning">Customer context is not loaded.</p>
          )}
        </div>

        {isReminder && (
          <div className="approve-section">
            <h4>Billing evidence</h4>
            {context ? (
              <Fields>
                <Field label="Status" value={context.billing.status} mono />
                <Field label="Amount due" value={formatMoney(context.billing.amount_due)} />
                <Field label="Due date" value={formatDate(context.billing.due_date)} />
                <Field label="Verified" value={formatUtc(context.billing.verified_at)} />
                <Field label="Dispute open" value={yesNo(context.billing.dispute_open)} tone={context.billing.dispute_open ? 'danger' : undefined} />
              </Fields>
            ) : (
              <p className="small text-warning">Customer context is not loaded.</p>
            )}
          </div>
        )}

        <div className="approve-section">
          <h4>Validation</h4>
          <p className="small">
            {draft.validation.passed ? 'Passed' : 'Failed'} · {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </p>
          {warnings.length > 0 && (
            <ul className="detail-list small">
              {warnings.map((w, i) => (
                <li key={i}>
                  <strong>{FINDING_LABELS[w.code]}</strong>: {w.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <fieldset className="delivery">
        <legend>Delivery</legend>
        <label className={`delivery-option ${delivery === 'draft_only' ? 'selected' : ''}`}>
          <input
            type="radio"
            name="delivery"
            value="draft_only"
            checked={delivery === 'draft_only'}
            onChange={() => setDelivery('draft_only')}
          />
          <span>
            <strong>Draft only</strong>
            <span className="small muted">Approve and keep as a draft. Nothing is sent, and it cannot be sent later.</span>
          </span>
        </label>
        <label className={`delivery-option ${delivery === 'mock_email' ? 'selected' : ''}`}>
          <input
            type="radio"
            name="delivery"
            value="mock_email"
            checked={delivery === 'mock_email'}
            onChange={() => setDelivery('mock_email')}
          />
          <span>
            <strong>Mock email</strong>
            <span className="small muted">Approve and write one entry to the mock outbox. No real email is sent.</span>
          </span>
        </label>
      </fieldset>

      <label className="form-field">
        <span className="small">Feedback (optional)</span>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="e.g. Verified reward terms and consent."
        />
      </label>

      <p className="small muted">Approval is final for this draft.</p>

      <div className="panel-actions">
        <button type="submit" className="btn-primary" disabled={disabled}>
          {working ? 'Approving…' : primaryLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
      </div>
    </form>
  )
}
