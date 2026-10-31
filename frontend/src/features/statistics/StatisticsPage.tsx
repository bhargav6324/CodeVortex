/**
 * Tab 3 — Statistics for THIS browser session (contract 1.0.0 has no statistics endpoint).
 * Draft IDs come from sessionStorage; each draft is fetched with GET /drafts/{id} when the
 * tab opens or on Refresh — never in a polling loop (every call counts against 60/min).
 */
import { AlertTriangle, BarChart3, Bot, CheckCircle2, Clock, PencilLine, Play, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { createDraft, getDraft } from '../../api/endpoints'
import { toApiError, type ApiError } from '../../api/errors'
import { useToken } from '../../app/context'
import type { Draft } from '../../types/contract'
import { newIdempotencyKey } from '../../utils/ids'
import { STATUS_DISPLAY } from '../../utils/labels'
import { Alert } from '../../ui/Alert'
import { Card } from '../../ui/Card'
import { Badge, Button, EmptyState, Spinner, StatTile } from '../../ui/primitives'
import { clearSessionLog, recordDraft, useSessionLog } from '../session/sessionLog'
import { computeStats, type CountRow } from './computeStats'

const DEMO_CUSTOMERS = ['C001', 'C004', 'C008', 'C011', 'C014', 'C007', 'C019', 'C023', 'C036']
const COLORS = ['#5f5ff2', '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#64748b']

/** Splits a label into lines of at most `max` characters, breaking between words. */
function wrapLabel(label: string, max = 12): string[] {
  const lines: string[] = []
  for (const word of label.split(' ')) {
    const last = lines.at(-1)
    if (last !== undefined && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return lines
}

/** X-axis label that wraps onto several lines so neighbouring labels never overlap. */
function WrappedTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value?: string | number } }) {
  const lines = wrapLabel(String(payload?.value ?? ''))
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fill="#334155" fontSize={11}>
        {lines.map((line, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 12 : 13}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  )
}

function ChartCard({ title, rows, horizontal = false }: { title: string; rows: CountRow[]; horizontal?: boolean }) {
  return (
    <Card title={title} actions={<Badge tone="brand">This session</Badge>}>
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">No data yet.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            {horizontal ? (
              <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="#eef0f5" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#334155' }} />
                <Tooltip cursor={{ fill: '#f5f6fb' }} />
                <Bar dataKey="value" name="Drafts" radius={[0, 6, 6, 0]} fill="#f43f5e" />
              </BarChart>
            ) : (
              <BarChart data={rows} margin={{ top: 8, right: 8 }}>
                <CartesianGrid vertical={false} stroke="#eef0f5" />
                <XAxis dataKey="name" tick={<WrappedTick />} interval={0} height={44} tickMargin={4} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={28} />
                <Tooltip cursor={{ fill: '#f5f6fb' }} />
                <Bar dataKey="value" name="Drafts" radius={[6, 6, 0, 0]}>
                  {rows.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

interface DemoRow {
  customerId: string
  state: 'waiting' | 'running' | 'done' | 'failed'
  detail: string
}

export function StatisticsPage() {
  const { tokenSet, focusTokenInput } = useToken()
  const log = useSessionLog()
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [demo, setDemo] = useState<DemoRow[] | null>(null)
  const demoRunning = useRef(false)

  const refresh = useCallback(async () => {
    const ids = log.drafts.map((d) => d.draftId)
    if (ids.length === 0) return
    setLoading(true)
    setLoadError(null)
    const next: Record<string, Draft> = {}
    // Small batches keep well under the 60 reads/minute limit for a normal session.
    for (let i = 0; i < ids.length; i += 3) {
      const batch = await Promise.allSettled(ids.slice(i, i + 3).map((id) => getDraft(id)))
      batch.forEach((r) => {
        if (r.status === 'fulfilled') next[r.value.data.draft_id] = r.value.data
        else setLoadError(toApiError(r.reason))
      })
    }
    setDrafts(next)
    setLoading(false)
  }, [log.drafts])

  // Fetch when the tab opens (and when new drafts join the session), never on a timer.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (tokenSet) void refresh()
  }, [tokenSet, refresh])

  async function runDemo() {
    if (demoRunning.current) return
    demoRunning.current = true
    const rows: DemoRow[] = DEMO_CUSTOMERS.map((id) => ({ customerId: id, state: 'waiting', detail: '' }))
    setDemo([...rows])
    for (let i = 0; i < rows.length; i++) {
      rows[i] = { ...rows[i], state: 'running', detail: 'Generating…' }
      setDemo([...rows])
      const started = performance.now()
      try {
        const res = await createDraft(rows[i].customerId, newIdempotencyKey('create'))
        const ms = Math.round(performance.now() - started)
        recordDraft({ draftId: res.data.draft_id, customerId: res.data.customer_id, generationMs: res.status === 201 ? ms : null, source: 'demo' })
        rows[i] = { ...rows[i], state: 'done', detail: `${STATUS_DISPLAY[res.data.status].label} · ${(ms / 1000).toFixed(1)} s` }
      } catch (e) {
        const err = toApiError(e)
        rows[i] = { ...rows[i], state: 'failed', detail: `${err.code}${err.retryAfterSeconds ? ` · wait ${err.retryAfterSeconds}s` : ''}` }
        setDemo([...rows])
        if (err.code === 'RATE_LIMITED' || err.code === 'UNAUTHORIZED') break
        continue
      }
      setDemo([...rows])
    }
    demoRunning.current = false
    setDemo([...rows])
  }

  const list = useMemo(() => log.drafts.map((d) => drafts[d.draftId]).filter((d): d is Draft => d !== undefined), [log.drafts, drafts])
  const stats = useMemo(() => computeStats(list, log.drafts), [list, log.drafts])
  const errorRows: CountRow[] = Object.entries(log.errors)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
  const demoBusy = demo?.some((r) => r.state === 'running' || r.state === 'waiting') ?? false

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-card">
        <div>
          <p className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
            Session statistics <Badge tone="brand">This session</Badge>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={RefreshCw} onClick={() => void refresh()} disabled={!tokenSet || loading || log.drafts.length === 0}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="primary" icon={Play} onClick={() => void runDemo()} disabled={!tokenSet || demoBusy}>
            {demoBusy ? 'Running scenarios…' : 'Run demo scenarios'}
          </Button>
          <Button variant="ghost" icon={Trash2} onClick={() => { clearSessionLog(); setDrafts({}) }} disabled={demoBusy || loading}>
            Clear
          </Button>
        </div>
      </div>

      {!tokenSet && (
        <Alert tone="warning" title="Paste your reviewer token to load statistics">
          <Button size="sm" onClick={focusTokenInput}>Go to token box</Button>
        </Alert>
      )}
      {loading && <Spinner label="Loading this session's drafts…" />}
      {loadError && <Alert tone="danger" title={`Some drafts could not be loaded (${loadError.code})`} onDismiss={() => setLoadError(null)}>{loadError.message}</Alert>}

      {demo && (
        <Card title="Demo scenarios" icon={Play} actions={<span className="text-xs text-slate-500">9 real drafts · under the 20/min limit</span>}>
          <ul className="grid gap-2 sm:grid-cols-3">
            {demo.map((r) => (
              <li key={r.customerId} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-200">
                <span className="font-mono text-xs font-semibold text-slate-700">{r.customerId}</span>
                <span className={r.state === 'failed' ? 'text-rose-700' : r.state === 'done' ? 'text-slate-700' : 'text-slate-400'}>
                  {r.state === 'waiting' ? 'Waiting' : r.detail}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">Use “Approve draft” (draft only) in rehearsals. Mock-sending records a contact and can block later drafts for that customer.</p>
        </Card>
      )}

      {log.drafts.length === 0 ? (
        <Card>
          <EmptyState icon={BarChart3} title="No drafts in this session yet" action={<Button variant="primary" icon={Play} onClick={() => void runDemo()} disabled={!tokenSet || demoBusy}>Run demo scenarios</Button>}>
            Generate drafts in the Review workspace or the AI assistant, or run the nine demo scenarios.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <StatTile label="Total drafts" icon={BarChart3} value={stats.total} hint="this session" accent />
            <StatTile label="Approval rate" icon={CheckCircle2} value={stats.approvalRate === null ? '—' : `${Math.round(stats.approvalRate * 100)}%`} hint="approved ÷ decided" />
            <StatTile label="Mock sent" icon={Send} value={stats.mockSent} hint="outbox rows" />
            <StatTile label="AI used / not needed" icon={Bot} value={`${stats.aiUsed} / ${stats.aiNotNeeded}`} hint="not_invoked = blocked before AI" />
            <StatTile label="Generation time" icon={Clock} value={stats.avgMs === null ? '—' : `${(stats.avgMs / 1000).toFixed(1)} s`} hint={stats.maxMs === null ? 'avg · measured in browser' : `avg · max ${(stats.maxMs / 1000).toFixed(1)} s`} />
            <StatTile label="Edits per draft" icon={PencilLine} value={stats.editsPerDraft === null ? '—' : stats.editsPerDraft.toFixed(1)} hint="revision − 1" />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard title="Drafts by status" rows={stats.byStatus} />
            <ChartCard title="Drafts by objective" rows={stats.byObjective} />
            <ChartCard title="Customers by segment" rows={stats.bySegment} />
            <ChartCard title="Top block reasons" rows={stats.blockReasons} horizontal />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="AI used versus not needed" icon={Bot} actions={<Badge tone="brand">This session</Badge>}>
              <div className="flex items-center gap-6">
                <div className="size-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={[{ name: 'AI used', value: stats.aiUsed }, { name: 'Not needed (blocked first)', value: stats.aiNotNeeded }]} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2}>
                        <Cell fill="#5f5ff2" />
                        <Cell fill="#cbd5e1" />
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-brand-500" /> AI used: <strong>{stats.aiUsed}</strong></li>
                  <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-slate-300" /> Not needed: <strong>{stats.aiNotNeeded}</strong></li>
                </ul>
              </div>
            </Card>
            <Card title="Errors seen" icon={AlertTriangle} actions={<Badge tone="brand">This session</Badge>}>
              {errorRows.length === 0 ? (
                <p className="text-sm text-slate-500">No errors this session.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {errorRows.map((r) => (
                    <li key={r.name} className="flex items-center justify-between py-2 text-sm">
                      <code className="font-mono text-xs text-slate-700">{r.name}</code>
                      <span className="font-semibold text-slate-900">{r.value}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
