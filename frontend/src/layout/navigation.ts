/**
 * The four tabs from the backend guide (FRONTEND_GUIDE.md section 2).
 * `proposed` tabs depend on endpoints that do not exist on contract 1.0.0 and stay hidden
 * until /health reports 1.1.0.
 */
import { Bot, ChartColumn, ClipboardCheck, History, type LucideIcon } from 'lucide-react'

export interface NavItem {
  key: 'review' | 'assistant' | 'statistics' | 'audit'
  label: string
  path: string
  icon: LucideIcon
  description: string
  proposed?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  {
    key: 'review',
    label: 'Review workspace',
    path: '/review',
    icon: ClipboardCheck,
    description: 'Pick a customer, check the facts, generate a draft, then edit, approve or reject it.',
  },
  {
    key: 'assistant',
    label: 'AI assistant',
    path: '/assistant',
    icon: Bot,
    description: 'The same workflow as a conversation. Every message maps to a backend call.',
  },
  {
    key: 'statistics',
    label: 'Statistics',
    path: '/statistics',
    icon: ChartColumn,
    description: 'Outcomes, block reasons and timings for the drafts in this browser session.',
  },
  {
    key: 'audit',
    label: 'Audit & outbox',
    path: '/audit',
    icon: History,
    description: 'Per-draft history, offer eligibility and the mock email record.',
    proposed: true,
  },
]

export function visibleNav(extensions: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.proposed || extensions)
}

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
}
