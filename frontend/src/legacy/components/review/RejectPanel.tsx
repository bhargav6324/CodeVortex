import { useState } from 'react'

/** Reject the draft (also allowed for blocked drafts). Nothing is ever sent. */
export function RejectPanel({ revision, working, disabled, onSubmit, onCancel }: {
  revision: number
  working: boolean
  disabled: boolean
  onSubmit: (feedback: string) => void
  onCancel: () => void
}) {
  const [feedback, setFeedback] = useState('')
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(feedback)
      }}
    >
      <h3 className="panel-title">Reject revision {revision}</h3>
      <p className="small">Rejecting closes this draft. Nothing is sent. You can generate a new draft afterwards.</p>
      <label className="form-field">
        <span className="small">Reason (optional)</span>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="e.g. Tone not appropriate for this customer."
        />
      </label>
      <div className="panel-actions">
        <button type="submit" className="btn-danger" disabled={disabled}>
          {working ? 'Rejecting…' : 'Reject draft'}
        </button>
        <button type="button" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
      </div>
    </form>
  )
}
