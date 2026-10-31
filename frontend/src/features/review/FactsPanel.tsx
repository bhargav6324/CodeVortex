/**
 * Panel 1: customer facts from GET /customers/{id}/context, shown exactly as returned.
 * Facts only; no eligibility or segment decisions are made in the browser.
 */
import { Activity, CalendarDays, Check, Gift, History, Receipt, ShieldCheck, Star, UserRound, Wallet, X } from 'lucide-react'
import type { Context } from '../../types/contract'
import { formatCount, formatDate, formatMoney, formatUtc, UNKNOWN, yesNo } from '../../utils/format'
import { BILLING_STATUS_DISPLAY } from '../../utils/labels'
import { Card, SectionLabel } from '../../ui/Card'
import { Badge, Code, Field, Fields, StatTile } from '../../ui/primitives'

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1 ring-inset ${on ? 'bg-emerald-50/60 ring-emerald-600/15' : 'bg-rose-50 ring-rose-600/20'}`}>
      <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <span className={`grid size-5 place-items-center rounded-full ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-600 text-white'}`}>
          {on ? <Check className="size-3" aria-hidden="true" /> : <X className="size-3" aria-hidden="true" />}
        </span>
        {label}
      </span>
      <span className={`text-xs font-semibold ${on ? 'text-emerald-700' : 'text-rose-700'}`}>{on ? 'Yes' : 'No'}</span>
    </div>
  )
}

function activityHint(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return 'previous 30 days unknown'
  if (previous === 0) return 'previous 30 days: 0'
  const change = Math.round(((current - previous) / previous) * 100)
  return `${change > 0 ? '+' : ''}${change}% vs previous (${previous})`
}

export function FactsPanel({ context }: { context: Context }) {
  const { customer, consent, billing, contacts, offers } = context
  const billingStatus = BILLING_STATUS_DISPLAY[billing.status]
  const initials = customer.display_name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

  return (
    <Card title="Customer facts" icon={UserRound} bodyClassName="space-y-6">
      <div className="flex items-center gap-3.5">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-100 to-violet-100 text-base font-bold text-brand-700 ring-1 ring-brand-200" aria-hidden="true">
          {initials || '?'}
        </span>
        <div className="min-w-0">
          <p className="customer-name truncate text-lg font-bold tracking-tight text-slate-900">{customer.display_name}</p>
          <p className="text-sm text-slate-500">
            <span className="font-mono text-xs">{customer.customer_id}</span> · {customer.active_plan}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <StatTile label="Loyalty points" icon={Star} value={customer.loyalty_points.toLocaleString('en-IN')} accent />
        <StatTile label="Tenure" icon={CalendarDays} value={`${customer.tenure_months} months`} />
        <StatTile
          label="Activity (30 days)"
          icon={Activity}
          value={formatCount(customer.activity_current_30d)}
          hint={activityHint(customer.activity_current_30d, customer.activity_previous_30d)}
        />
        <StatTile
          label="On-time payments"
          icon={Receipt}
          value={customer.timely_payments_last_3 === null ? UNKNOWN : `${customer.timely_payments_last_3} of 3`}
          hint="last 3 bills"
        />
      </div>

      <Fields>
        <Field label="Customer ID" value={customer.customer_id} mono />
        <Field label="Last activity" value={formatUtc(customer.last_activity_at)} />
        <Field label="Activity, previous 30 days" value={formatCount(customer.activity_previous_30d)} />
      </Fields>

      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden="true" /> Consent
          </span>
        </SectionLabel>
        <div className="space-y-1.5">
          <Flag label="Email allowed" on={consent.email_allowed} />
          <Flag label="Marketing opt-in" on={consent.marketing_opt_in} />
          <Flag label="Service emails" on={consent.service_email_allowed} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Recorded {formatUtc(consent.recorded_at)} · <span className="font-mono">{consent.source}</span>
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>
            <span className="inline-flex items-center gap-1.5">
              <Wallet className="size-3.5" aria-hidden="true" /> Billing
            </span>
          </SectionLabel>
          <Badge tone={billingStatus.tone}>{billingStatus.label}</Badge>
        </div>
        <p className={`text-2xl font-bold tracking-tight ${billing.amount_due === null ? 'italic text-slate-400' : 'text-slate-900'}`}>{formatMoney(billing.amount_due)}</p>
        <p className="mb-1 text-xs text-slate-500">Amount due</p>
        <Fields>
          <Field label="Bill ID" value={billing.bill_id} mono />
          <Field label="Due date" value={formatDate(billing.due_date)} />
          <Field label="Verified" value={formatUtc(billing.verified_at)} />
          <Field label="Dispute open" value={yesNo(billing.dispute_open)} tone={billing.dispute_open ? 'danger' : undefined} />
        </Fields>
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">{billing.support_text}</p>
      </div>

      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <History className="size-3.5" aria-hidden="true" /> Recent contacts · {contacts.length}
          </span>
        </SectionLabel>
        {contacts.length === 0 ? (
          <p className="text-sm text-slate-500">No previous contacts on record.</p>
        ) : (
          <ul className="space-y-1.5">
            {contacts.map((c) => (
              <li key={c.contact_id} className="flex flex-col rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
                <span className="font-mono text-xs text-slate-700">{c.campaign_key}</span>
                <span className="text-xs text-slate-500">
                  {formatUtc(c.sent_at)} · {c.delivery}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <Gift className="size-3.5" aria-hidden="true" /> Offers in context · {offers.length}
          </span>
        </SectionLabel>
        {offers.length === 0 ? (
          <p className="text-sm text-slate-500">No offers in this customer's context.</p>
        ) : (
          <ul className="space-y-2">
            {offers.map((o) => (
              <li key={o.offer_id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                  {o.title} <Code>{o.offer_id}</Code>
                </p>
                <p className="mt-1 text-xs text-slate-600">{o.terms}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {formatMoney(o.value)} · until {formatUtc(o.expires_at)} · min {o.min_loyalty_points} pts, {o.min_tenure_months} months
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-slate-400">
        Data as of {formatUtc(context.as_of)} · <span className="font-mono">{context.data_version}</span>
      </p>
    </Card>
  )
}
