/** Pure statistics over the drafts of this browser session (FRONTEND_GUIDE.md, Tab 3). */
import type { Draft } from '../../types/contract'
import { OBJECTIVE_LABELS, SEGMENT_LABELS, STATUS_DISPLAY } from '../../utils/labels'
import type { SessionDraft } from '../session/sessionLog'

export interface CountRow {
  name: string
  value: number
}

export interface SessionStats {
  total: number
  byStatus: CountRow[]
  byObjective: CountRow[]
  bySegment: CountRow[]
  blockReasons: CountRow[]
  aiUsed: number
  aiNotNeeded: number
  avgMs: number | null
  maxMs: number | null
  approvalRate: number | null
  mockSent: number
  editsPerDraft: number | null
}

function count<T extends string>(keys: T[], labels?: Record<T, string>): CountRow[] {
  const map = new Map<T, number>()
  for (const k of keys) map.set(k, (map.get(k) ?? 0) + 1)
  return [...map.entries()].map(([k, v]) => ({ name: labels ? labels[k] : k, value: v })).sort((a, b) => b.value - a.value)
}

export function computeStats(drafts: Draft[], log: SessionDraft[]): SessionStats {
  const timings = log.map((d) => d.generationMs).filter((ms): ms is number => ms !== null)
  const approved = drafts.filter((d) => d.status === 'approved' || d.status === 'mock_sent').length
  const rejected = drafts.filter((d) => d.status === 'rejected').length
  const statusLabels = Object.fromEntries(Object.entries(STATUS_DISPLAY).map(([k, v]) => [k, v.label])) as Record<Draft['status'], string>

  return {
    total: drafts.length,
    byStatus: count(drafts.map((d) => d.status), statusLabels),
    byObjective: count(
      drafts.map((d) => d.strategy?.objective).filter((o): o is NonNullable<typeof o> => o !== undefined),
      OBJECTIVE_LABELS,
    ),
    bySegment: count(drafts.flatMap((d) => d.segments.map((s) => s.code)), SEGMENT_LABELS),
    blockReasons: count(drafts.flatMap((d) => d.validation.findings.filter((f) => f.severity === 'block').map((f) => f.code))),
    aiUsed: drafts.filter((d) => d.versions.model_version !== 'not_invoked').length,
    aiNotNeeded: drafts.filter((d) => d.versions.model_version === 'not_invoked').length,
    avgMs: timings.length ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) : null,
    maxMs: timings.length ? Math.max(...timings) : null,
    approvalRate: approved + rejected > 0 ? approved / (approved + rejected) : null,
    mockSent: drafts.filter((d) => d.status === 'mock_sent').length,
    editsPerDraft: drafts.length ? drafts.reduce((a, d) => a + (d.revision - 1), 0) / drafts.length : null,
  }
}
