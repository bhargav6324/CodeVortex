/**
 * First-run guide shown in the draft area until a draft exists. Each step ticks off as the
 * reviewer completes it, so the next action is always obvious.
 */
type StepState = 'done' | 'current' | 'todo'

interface Step {
  title: string
  text: string
  state: StepState
  action?: { label: string; onClick: () => void; disabled?: boolean }
}

export function GettingStarted({ tokenSet, customerLoaded, customerName, onFocusToken }: {
  tokenSet: boolean
  customerLoaded: boolean
  customerName: string | null
  onFocusToken: () => void
}) {
  const steps: Step[] = [
    {
      title: 'Paste the reviewer token',
      text: 'Top right of the page. It stays in memory only.',
      state: tokenSet ? 'done' : 'current',
      action: tokenSet ? undefined : { label: 'Go to token box', onClick: onFocusToken },
    },
    {
      title: 'Load a customer',
      text: customerLoaded && customerName ? `Loaded: ${customerName}. Check their facts on the left.` : 'Pick a customer on the left.',
      state: customerLoaded ? 'done' : tokenSet ? 'current' : 'todo',
    },
    {
      title: 'Generate a draft',
      text: customerLoaded
        ? 'Press "Generate draft" above. The backend segments the customer, picks a policy strategy and writes the email. Nothing is sent.'
        : 'The backend segments the customer, picks a policy strategy and writes the email. Nothing is sent.',
      state: customerLoaded ? 'current' : 'todo',
    },
    {
      title: 'Review it',
      text: 'Check segments, evidence and validation, then edit, approve (draft only or mock email) or reject.',
      state: 'todo',
    },
  ]

  return (
    <section className="card getting-started" aria-label="Getting started">
      <h2 className="gs-title">Getting started</h2>
      <ol className="steps">
        {steps.map((step, i) => (
          <li key={step.title} className={`step step-${step.state}`}>
            <span className="step-marker" aria-hidden="true">
              {step.state === 'done' ? '✓' : i + 1}
            </span>
            <div className="step-body">
              <p className="step-title">
                {step.title}
                <span className="sr-only"> ({step.state === 'done' ? 'done' : step.state === 'current' ? 'next' : 'later'})</span>
              </p>
              <p className="small muted">{step.text}</p>
              {step.action && (
                <button
                  type="button"
                  className={step.state === 'current' ? 'btn-primary small' : 'small'}
                  onClick={step.action.onClick}
                  disabled={step.action.disabled}
                >
                  {step.action.label}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
