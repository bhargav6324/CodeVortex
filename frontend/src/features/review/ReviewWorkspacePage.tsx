/**
 * Tab 1 — Review workspace (FRONTEND_GUIDE.md): customer picker on the left; three panels on
 * the right: customer facts, decision, email preview + actions.
 * All state lives in the shared review workflow, so switching tabs keeps your work.
 */
import { ClipboardCheck, KeyRound, Sparkles, UserRound } from 'lucide-react'
import { useEffect } from 'react'
import { USE_MOCKS } from '../../api/config'
import { useToken } from '../../app/context'
import { customersFor } from '../../config/customers'
import { Alert, ErrorAlert } from '../../ui/Alert'
import { Card } from '../../ui/Card'
import { Button, EmptyState, Spinner } from '../../ui/primitives'
import { CustomerList } from './CustomerList'
import { DecisionPanel } from './DecisionPanel'
import { EmailPanel } from './EmailPanel'
import { FactsPanel } from './FactsPanel'
import { useReview } from './reviewContext'

const customers = customersFor(USE_MOCKS)

export function ReviewWorkspacePage() {
  const wf = useReview()
  const { tokenSet, focusTokenInput } = useToken()
  const { context, draft, busy, failure } = wf
  const contextMatches = context !== null && context.customer.customer_id === wf.customerId
  const createFailure = failure !== null && failure.scope !== 'review' ? failure : null
  const selected = customers.find((c) => c.id === wf.customerId)

  // After a 401, put the cursor in the token box.
  const unauthorized = failure?.error.code === 'UNAUTHORIZED' || wf.contextError?.code === 'UNAUTHORIZED'
  useEffect(() => {
    if (unauthorized) focusTokenInput()
  }, [unauthorized, focusTokenInput])

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <CustomerList customers={customers} selectedId={wf.customerId} onSelect={(id) => wf.selectCustomer(id, tokenSet)} disabled={busy !== null || wf.contextLoading} />

      <div className="min-w-0 space-y-5">
        {wf.resumable && (
          <Alert tone="info" title="Continue where you left off?">
            <p>
              You were reviewing {wf.resumable.draftId ? <span className="font-mono">{wf.resumable.draftId}</span> : 'a draft'} for{' '}
              <span className="font-mono">{wf.resumable.customerId}</span>.{wf.resumable.pending && ' Your last action may not have finished.'}
            </p>
            {!tokenSet && <p className="text-xs">Paste the reviewer token first; it is not kept after a reload.</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="primary" size="sm" onClick={() => void wf.resume()} disabled={!tokenSet || busy !== null}>
                Resume
              </Button>
              <Button size="sm" onClick={wf.dismissResume} disabled={busy !== null}>
                Start fresh
              </Button>
            </div>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-card">
          <div className="min-w-0">
            <p className="text-lg font-bold tracking-tight text-slate-900">{contextMatches ? context.customer.display_name : (selected?.id ?? 'Select a customer')}</p>
            <p className="text-sm text-slate-500">
              <span className="font-mono">{wf.customerId}</span>
              {selected && ` · ${selected.label}`} · generating creates a draft for review; it never approves or sends.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!contextMatches && tokenSet && (
              <Button onClick={() => void wf.loadContext(wf.customerId)} disabled={busy !== null || wf.contextLoading}>
                Load customer
              </Button>
            )}
            <Button variant="primary" icon={Sparkles} onClick={() => void wf.generate()} disabled={!contextMatches || busy !== null}>
              {busy === 'create' ? 'Generating…' : draft ? 'Generate new draft' : 'Generate draft'}
            </Button>
          </div>
        </div>

        {!tokenSet && (
          <Alert tone="warning" title="Paste your reviewer token to start">
            <p>The backend team gives each reviewer a token. It stays in memory only and is never saved.</p>
            <div className="pt-1">
              <Button size="sm" icon={KeyRound} onClick={focusTokenInput}>
                Go to token box
              </Button>
            </div>
          </Alert>
        )}

        {wf.contextLoading && <Spinner label="Loading customer facts…" />}
        {busy === 'create' && <Spinner label="Generating the draft — usually 2–6 seconds (up to 40)…" />}
        {busy === 'retry' && createFailure && <Spinner label="Retrying with the same request key…" />}
        {wf.contextError && <ErrorAlert title="Could not load the customer" error={wf.contextError} onDismiss={wf.clearContextError} />}
        {createFailure && (
          <ErrorAlert
            title={createFailure.scope === 'create' ? 'Draft generation failed' : 'Could not load the draft'}
            error={createFailure.error}
            hint={createFailure.hint}
            onRetry={wf.hasPendingRetry ? () => void wf.retry() : undefined}
            retryReadyAt={createFailure.retryReadyAt}
            onDismiss={wf.discardFailure}
            busy={busy !== null}
          />
        )}
        {wf.notice && (
          <Alert tone={wf.notice.tone === 'success' ? 'success' : wf.notice.tone === 'warning' ? 'warning' : 'info'} title={wf.notice.title} onDismiss={wf.dismissNotice}>
            {wf.notice.text && <p>{wf.notice.text}</p>}
          </Alert>
        )}

        {contextMatches ? (
          <div className="grid items-start gap-5 xl:grid-cols-2 2xl:grid-cols-3">
            <FactsPanel context={context} />
            {draft ? (
              <>
                <DecisionPanel draft={draft} context={context} />
                <div className="xl:col-span-2 2xl:col-span-1">
                  <EmailPanel
                    key={`${draft.draft_id}:${draft.revision}`}
                    draft={draft}
                    context={context}
                    stale={wf.isStale}
                    busy={busy}
                    failure={failure}
                    canRetry={wf.hasPendingRetry}
                    onReview={(body) => void wf.review(body)}
                    onRetry={() => void wf.retry()}
                    onDiscard={wf.discardFailure}
                    onGenerateNew={() => void wf.generate()}
                    onRefresh={() => void wf.refresh()}
                  />
                </div>
              </>
            ) : (
              busy !== 'create' && (
                <Card className="xl:col-span-1 2xl:col-span-2">
                  <EmptyState
                    icon={ClipboardCheck}
                    title="No draft yet"
                    action={
                      <Button variant="primary" icon={Sparkles} onClick={() => void wf.generate()} disabled={busy !== null}>
                        Generate draft
                      </Button>
                    }
                  >
                    Check the customer facts, then generate. The backend segments the customer, applies policy and writes the email from an approved template.
                  </EmptyState>
                </Card>
              )
            )}
          </div>
        ) : (
          !wf.contextLoading &&
          !wf.contextError &&
          tokenSet && (
            <Card>
              <EmptyState icon={UserRound} title="Pick a customer">
                Choose a customer on the left. The nine demo scenarios are at the top.
              </EmptyState>
            </Card>
          )
        )}
      </div>
    </div>
  )
}
