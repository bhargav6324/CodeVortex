/**
 * Backend liveness and contract version from GET /health (no token needed).
 * Checked on load and every 30 seconds, as the backend guide asks.
 * The proposed v1.1.0 features (audit, outbox, eligibility) are shown only when the
 * backend reports contract_version "1.1.0"; on "1.0.0" they stay hidden.
 */
import { useCallback, useEffect, useState } from 'react'
import { getHealth } from '../api/endpoints'
import { CONTRACT_V11, SUPPORTED_CONTRACT_VERSIONS } from '../types/contractV11'

export type HealthState = 'checking' | 'online' | 'offline' | 'unsupported'

export interface BackendHealth {
  state: HealthState
  /** contract_version reported by the backend, or null if unknown */
  version: string | null
  /** True when the backend implements the proposed v1.1.0 endpoints */
  extensions: boolean
  recheck: () => void
}

const POLL_MS = 30_000

export function useBackendHealth(): BackendHealth {
  const [state, setState] = useState<HealthState>('checking')
  const [version, setVersion] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    const check = () =>
      getHealth()
        .then((res) => {
          if (!active) return
          const v = res.data.contract_version
          setVersion(v)
          setState((SUPPORTED_CONTRACT_VERSIONS as readonly string[]).includes(v) ? 'online' : 'unsupported')
        })
        .catch(() => {
          if (!active) return
          setVersion(null)
          setState('offline')
        })
    void check()
    const timer = setInterval(() => void check(), POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [attempt])

  const recheck = useCallback(() => {
    setState('checking')
    setAttempt((n) => n + 1)
  }, [])

  return { state, version, extensions: state === 'online' && version === CONTRACT_V11, recheck }
}
