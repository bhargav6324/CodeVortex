import { useState } from 'react'
import type { Message } from '../../../types/contract'

/**
 * Edit the subject/body and send the COMPLETE proposed text. v1 only accepts formatting
 * fixes; wording changes are refused by the backend (422 REVIEW_BLOCKED). The typed text
 * stays here after a refusal so the reviewer can correct it.
 */
export function EditPanel({ message, revision, working, disabled, refused, onSubmit, onCancel }: {
  message: Message
  revision: number
  working: boolean
  disabled: boolean
  /** True when the last edit attempt was refused by the backend. */
  refused: boolean
  onSubmit: (subject: string, body: string) => void
  onCancel: () => void
}) {
  const [subject, setSubject] = useState(message.subject)
  const [body, setBody] = useState(message.body)
  const changed = subject !== message.subject || body !== message.body
  const empty = subject.trim() === '' || body.trim() === ''

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(subject, body)
      }}
    >
      <h3 className="panel-title">Edit revision {revision}</h3>
      <p className="small banner-inline-info">
        In v1 only formatting fixes are accepted (line endings, spaces around the text). The wording must match the
        approved template. To change wording, generate a new draft instead.
      </p>

      {refused && (
        <p className="small text-danger" role="alert">
          The backend refused this edit. The original draft is unchanged. Your text is kept below so you can correct it,
          or press Cancel to discard it.
        </p>
      )}

      <label className="form-field">
        <span className="small">Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} />
      </label>
      <label className="form-field">
        <span className="small">Body (plain text)</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={9} spellCheck />
      </label>

      <div className="panel-actions">
        <button type="submit" className="btn-primary" disabled={disabled || empty}>
          {working ? 'Saving…' : 'Save edit'}
        </button>
        <button type="button" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
        {!changed && <span className="small muted">No changes yet.</span>}
      </div>
    </form>
  )
}
