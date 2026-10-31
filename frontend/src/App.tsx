/**
 * LoyaltyAI routes — the four tabs from FRONTEND_GUIDE.md.
 *
 *   /review      Tab 1: review workspace
 *   /assistant   Tab 2: AI assistant (conversation view)
 *   /statistics  Tab 3: statistics for this session
 *   /audit       Tab 4: audit and outbox (proposed v1.1; hidden on contract 1.0.0)
 *   /legacy      the earlier single-page reviewer screen (kept as a fallback)
 */
import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AppProviders } from './app/AppProviders'
import { AssistantPage } from './features/assistant/AssistantPage'
import { AuditPage } from './features/audit/AuditPage'
import { ReviewWorkspacePage } from './features/review/ReviewWorkspacePage'
import { AppLayout } from './layout/AppLayout'
import LegacyApp from './legacy/LegacyApp'
import { Spinner } from './ui/primitives'

// Charts (Recharts) load only when the Statistics tab is opened.
const StatisticsPage = lazy(() => import('./features/statistics/StatisticsPage').then((m) => ({ default: m.StatisticsPage })))

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/legacy" element={<LegacyApp />} />
        <Route
          element={
            <AppProviders>
              <AppLayout />
            </AppProviders>
          }
        >
          <Route index element={<Navigate to="/review" replace />} />
          <Route path="/review" element={<ReviewWorkspacePage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route
            path="/statistics"
            element={
              <Suspense fallback={<Spinner label="Loading statistics…" />}>
                <StatisticsPage />
              </Suspense>
            }
          />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/review" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
