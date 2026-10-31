import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { onApiError, setAuthToken } from '../api/client'
import { USE_MOCKS } from '../api/config'
import { customersFor } from '../config/customers'
import { AssistantProvider } from '../features/assistant/AssistantProvider'
import { ReviewContext } from '../features/review/reviewContext'
import { recordError } from '../features/session/sessionLog'
import { useBackendHealth } from '../hooks/useBackendHealth'
import { useReviewWorkflow } from '../hooks/useReviewWorkflow'
import { HealthContext, TokenContext, type TokenValue } from './context'

const DEFAULT_CUSTOMER = customersFor(USE_MOCKS)[0].id

function ReviewProvider({ children }: { children: ReactNode }) {
  const workflow = useReviewWorkflow(DEFAULT_CUSTOMER)
  return <ReviewContext.Provider value={workflow}>{children}</ReviewContext.Provider>
}

/** App-wide state: reviewer token (memory only), /health poller, review workflow, assistant chat. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [tokenSet, setTokenSet] = useState(false)
  const tokenInput = useRef<HTMLInputElement | null>(null)
  const health = useBackendHealth()

  // Session statistics: count every API error by code.
  useEffect(() => onApiError((e) => recordError(e.code)), [])

  const token = useMemo<TokenValue>(
    () => ({
      tokenSet,
      setToken: (value) => {
        setAuthToken(value)
        setTokenSet(value.trim() !== '')
      },
      focusTokenInput: () => tokenInput.current?.focus(),
      registerTokenInput: (el) => {
        tokenInput.current = el
      },
    }),
    [tokenSet],
  )

  return (
    <TokenContext.Provider value={token}>
      <HealthContext.Provider value={health}>
        <ReviewProvider>
          <AssistantProvider>{children}</AssistantProvider>
        </ReviewProvider>
      </HealthContext.Provider>
    </TokenContext.Provider>
  )
}
