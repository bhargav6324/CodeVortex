import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tailwind.css'
import App from './App.tsx'
import { USE_MOCKS } from './api/config'

/**
 * Start the MSW mock backend before rendering when VITE_USE_MOCKS=true.
 * Setting VITE_USE_MOCKS=false is the only switch needed to use the real backend.
 */
async function enableMocking(): Promise<void> {
  if (!USE_MOCKS) return
  const { worker } = await import('./mocks/browser')
  await worker.start({ onUnhandledFrame: 'bypass' })
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
