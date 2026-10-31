/**
 * Panel 2: the backend's decision from the Draft — every segment with reason codes,
 * confidence and exact evidence, the strategy, the selected offer and validation findings.
 * React only displays these; it never decides eligibility, tone or reminder stage.
 */
import { CheckCircle2, Gift, Layers, ShieldCheck, Target } from 'lucide-react'
import type { Context, Draft, Evidence } from '../../types/contract'
import { formatEvidenceValue, formatMoney, formatPercent, formatUtc, utcDate } from '../../utils/format'
import { FINDING_LABELS, OBJECTIVE_LABELS, REASON_LABELS, REMINDER_STAGE_LABELS, SEGMENT_LABELS, TONE_LABELS } from '../../utils/labels'
import { Card, SectionLabel } from '../../ui/Card'
import { Badge, Code, Field, Fields } from '../../ui/primitives'

const SEGMENT_ACCENT: Record<string, string> = {
  consistent: 'border-l-emerald-500',
  loyalty_candidate: 'border-l-violet-500',
  declining_activity: 'border-l-amber-500',
  dormant: 'border-l-slate-400',
  payment_reminder: 'border-l-rose-500',
}

export function EvidenceTable({ evidence, empty = 'No evidence returned.' }: { evidence: Evidence[]; empty?: string }) {
  if (evidence.length === 0) return <p className="text-xs text-slate-500">{empty}</p>
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
          <th className="pb-1 pr-3 font-semibold">Field</th>
          <th className="pb-1 font-semibold">Value</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {evidence.map((e, i) => (
          <tr key={`${e.field}-${i}`}>
            <td className="break-all py-1 pr-3 font-mono text-slate-600">{e.field}</td>
            <td className={`break-all py-1 font-mono ${e.value === null ? 'italic text-slate-400' : 'text-slate-900'}`}>{formatEvidenceValue(e)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function DecisionPanel({ draft, context }: { draft: Draft; context: Context | null }) {
  const offer = draft.selected_offer_id === null ? null : context?.offers.find((o) => o.offer_id === draft.selected_offer_id)
  const findings = [...draft.validation.findings].sort((a, b) => Number(b.severity === 'block') - Number(a.severity === 'block'))

  return (
    <Card title="Decision" icon={Target} bodyClassName="space-y-6">
      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <Layers className="size-3.5" aria-hidden="true" /> Segments · {draft.segments.length}
          </span>
        </SectionLabel>
        {draft.segments.length === 0 ? (
          <p className="text-sm text-slate-500">No segment matched for this customer.</p>
        ) : (
          <div className="space-y-3">
            {draft.segments.map((s) => (
              <article key={s.code} className={`segment rounded-xl border border-l-4 border-slate-200 bg-slate-50/60 p-3.5 ${SEGMENT_ACCENT[s.code] ?? ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{SEGMENT_LABELS[s.code]}</h3>
                  <Code>{s.code}</Code>
                </div>
                <div className="mt-2 flex items-center gap-2.5" title="Rule confidence (not an AI probability)">
                  <span className="text-xs text-slate-500">Rule confidence</span>
                  <span className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                    <span className="block h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500" style={{ width: formatPercent(s.confidence) }} />
                  </span>
                  <span className="text-xs font-semibold text-slate-700">{formatPercent(s.confidence)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.reason_codes.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
                      {REASON_LABELS[r]} <Code>{r}</Code>
                    </span>
                  ))}
                </div>
                <div className="mt-2.5">
                  <EvidenceTable evidence={s.evidence} />
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <Target className="size-3.5" aria-hidden="true" /> Strategy
          </span>
        </SectionLabel>
        {draft.strategy === null ? (
          <p className="text-sm text-slate-500">No strategy was selected; the backend blocked this draft first.</p>
        ) : (
          <Fields>
            <Field label="Objective" value={<span className="inline-flex flex-wrap items-center gap-1.5">{OBJECTIVE_LABELS[draft.strategy.objective]} <Code>{draft.strategy.objective}</Code></span>} />
            <Field label="Tone" value={<span className="inline-flex flex-wrap items-center gap-1.5">{TONE_LABELS[draft.strategy.tone]} <Code>{draft.strategy.tone}</Code></span>} />
            <Field label="Template" value={draft.strategy.template_id} mono />
            <Field label="Reminder stage" value={REMINDER_STAGE_LABELS[draft.strategy.reminder_stage]} />
          </Fields>
        )}
      </div>

      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <Gift className="size-3.5" aria-hidden="true" /> Selected offer
          </span>
        </SectionLabel>
        {draft.selected_offer_id === null ? (
          <p className="text-sm text-slate-500">No offer is included in this draft.</p>
        ) : offer ? (
          <div className="rounded-xl bg-gradient-to-br from-brand-50 to-violet-50 p-3.5 ring-1 ring-inset ring-brand-100">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
              {offer.title} <Code>{offer.offer_id}</Code>
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">{offer.terms}</p>
            <p className="mt-2 text-xs text-slate-600">
              Value {formatMoney(offer.value)} · expires <strong>{utcDate(offer.expires_at)}</strong> ({formatUtc(offer.expires_at)})
            </p>
          </div>
        ) : (
          <p className="text-sm text-amber-700">
            Offer <span className="font-mono">{draft.selected_offer_id}</span> is not in the loaded customer context. Reload the customer.
          </p>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" aria-hidden="true" /> Validation
            </span>
          </SectionLabel>
          <Badge tone={draft.validation.passed ? 'success' : 'danger'}>{draft.validation.passed ? 'Passed' : 'Failed'}</Badge>
        </div>
        {findings.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/15">
            <CheckCircle2 className="size-4" aria-hidden="true" /> All checks passed. No findings.
          </p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f, i) => (
              <li key={i} className={`rounded-xl border-l-4 p-3 ring-1 ring-inset ${f.severity === 'block' ? 'border-l-rose-500 bg-rose-50 ring-rose-600/15' : 'border-l-amber-500 bg-amber-50 ring-amber-600/20'}`}>
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                  <Badge tone={f.severity === 'block' ? 'danger' : 'warning'}>{f.severity === 'block' ? 'Block' : 'Warning'}</Badge>
                  {FINDING_LABELS[f.code]} <Code>{f.code}</Code>
                </p>
                <p className="mt-1 text-sm text-slate-700">{f.message}</p>
                {f.field !== null && <p className="mt-0.5 font-mono text-[11px] text-slate-500">{f.field}</p>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          Checked {formatUtc(draft.validation.checked_at)} · {draft.validation.validator_version}
        </p>
      </div>

      <div>
        <SectionLabel>Evidence behind this draft</SectionLabel>
        <EvidenceTable evidence={draft.evidence} empty="No draft-level evidence returned." />
      </div>
    </Card>
  )
}
