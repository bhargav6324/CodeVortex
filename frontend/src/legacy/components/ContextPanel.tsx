/**
 * Shows the permitted customer Context exactly as the backend returned it.
 * Facts only — no eligibility or segment decisions are made here.
 */
import type { Context } from '../../types/contract'
import { formatCount, formatDate, formatMoney, formatUtc, UNKNOWN, yesNo } from '../../utils/format'
import { BILLING_STATUS_DISPLAY } from '../../utils/labels'
import { Avatar, Badge, Card, Field, Fields, Flag, Stat } from './ui'

function activityHint(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null) return 'previous 30 days unknown'
  if (previous === 0) return `previous 30 days: ${previous}`
  const change = Math.round(((current - previous) / previous) * 100)
  return `${change > 0 ? '+' : ''}${change}% vs previous 30 days (${previous})`
}

export function ContextPanel({ context }: { context: Context }) {
  const { customer, consent, billing, contacts, offers } = context
  const billingStatus = BILLING_STATUS_DISPLAY[billing.status]

  return (
    <div className="stack">
      <section className="card profile">
        <div className="profile-head">
          <Avatar name={customer.display_name} />
          <div className="profile-id">
            <p className="customer-name">{customer.display_name}</p>
            <p className="muted small">
              {customer.active_plan} · {customer.tenure_months} months with us
            </p>
          </div>
        </div>
        <div className="stat-grid">
          <Stat label="Loyalty points" icon="star" value={customer.loyalty_points.toLocaleString('en-IN')} />
          <Stat label="Tenure" icon="calendar" value={`${customer.tenure_months} mo`} />
          <Stat
            label="Activity (30 days)"
            icon="activity"
            value={formatCount(customer.activity_current_30d)}
            hint={activityHint(customer.activity_current_30d, customer.activity_previous_30d)}
          />
          <Stat
            label="On-time payments"
            icon="receipt"
            value={customer.timely_payments_last_3 === null ? UNKNOWN : `${customer.timely_payments_last_3}/3`}
            hint="last 3 bills"
          />
        </div>
        <Fields>
          <Field label="Customer ID" value={customer.customer_id} mono />
          <Field label="Active plan" value={customer.active_plan} mono />
          <Field label="Last activity" value={formatUtc(customer.last_activity_at)} />
          <Field label="Activity, previous 30 days" value={formatCount(customer.activity_previous_30d)} />
        </Fields>
      </section>

      <Card title="Consent" icon="shield">
        <div className="flags">
          <Flag label="Email allowed" on={consent.email_allowed} />
          <Flag label="Marketing opt-in" on={consent.marketing_opt_in} />
          <Flag label="Service emails" on={consent.service_email_allowed} />
        </div>
        <p className="muted small">
          Recorded {formatUtc(consent.recorded_at)} · <span className="mono">{consent.source}</span>
        </p>
      </Card>

      <Card title="Billing" icon="wallet" actions={<Badge tone={billingStatus.tone}>{billingStatus.label}</Badge>}>
        <div className="amount">
          <span className="amount-label">Amount due</span>
          <span className={`amount-value ${billing.amount_due === null ? 'unknown' : ''}`}>{formatMoney(billing.amount_due)}</span>
        </div>
        <Fields>
          <Field label="Bill ID" value={billing.bill_id} mono />
          <Field label="Due date" value={formatDate(billing.due_date)} />
          <Field label="Verified" value={formatUtc(billing.verified_at)} />
          <Field label="Dispute open" value={yesNo(billing.dispute_open)} tone={billing.dispute_open ? 'danger' : undefined} />
        </Fields>
        <p className="support-text">{billing.support_text}</p>
      </Card>

      <Card title={`Recent contacts · ${contacts.length}`} icon="history">
        {contacts.length === 0 ? (
          <p className="muted small">No previous contacts on record.</p>
        ) : (
          <ul className="plain-list">
            {contacts.map((c) => (
              <li key={c.contact_id}>
                <span className="mono small">{c.campaign_key}</span>
                <span className="muted small">
                  {formatUtc(c.sent_at)} · {c.delivery}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Approved offers · ${offers.length}`} icon="gift">
        {offers.length === 0 ? (
          <p className="muted small">No offers in this customer's context.</p>
        ) : (
          <ul className="plain-list">
            {offers.map((o) => (
              <li key={o.offer_id} className="offer-item">
                <span className="offer-item-head">
                  <strong>{o.title}</strong> <span className="code">{o.offer_id}</span>
                </span>
                <span className="small">{o.terms}</span>
                <span className="muted small">
                  {formatMoney(o.value)} · valid {formatUtc(o.valid_from)} → {formatUtc(o.expires_at)}
                </span>
                <span className="muted small">
                  Min {o.min_loyalty_points} points · min {o.min_tenure_months} months · plans{' '}
                  {o.allowed_plans.length > 0 ? o.allowed_plans.join(', ') : 'none'} · marketing consent{' '}
                  {o.requires_marketing_consent ? 'required' : 'not required'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="muted small snapshot">
        Data as of {formatUtc(context.as_of)} · <span className="mono">{context.data_version}</span>
      </p>
    </div>
  )
}
