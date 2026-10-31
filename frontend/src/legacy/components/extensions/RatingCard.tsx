import { useState } from 'react'
import type { RatingFailure } from '../../../hooks/useDraftDetails'
import type { Draft } from '../../../types/contract'
import { RUBRIC_CRITERIA, type Rating, type RatingRequest, type RubricCriterion, type Score } from '../../../types/contractV11'
import { formatUtc } from '../../../utils/format'
import { RUBRIC_LABELS } from '../../../utils/labels'
import { ErrorBanner } from '../ErrorBanner'
import { Card } from '../ui'

const SCORES: Score[] = [1, 2, 3, 4, 5]

function average(r: Rating): string {
  const total = RUBRIC_CRITERIA.reduce((sum, c) => sum + r[c], 0)
  return (total / RUBRIC_CRITERIA.length).toFixed(1)
}

/**
 * Proposed v1.1.0: the reviewer rubric from the brief's evaluation guidance
 * (relevance, clarity, personalization, call to action, tone). Feeds the evaluation
 * report; it does not affect approval and does not change the draft revision.
 */
export function RatingCard({ draft, ratings, busy, failure, saved, onSubmit, onRetry, onDismiss }: {
  draft: Draft
  ratings: Rating[]
  busy: boolean
  failure: RatingFailure | null
  saved: boolean
  onSubmit: (body: RatingRequest) => void
  onRetry: () => void
  onDismiss: () => void
}) {
  const [scores, setScores] = useState<Partial<Record<RubricCriterion, Score>>>({})
  const [comment, setComment] = useState('')
  const complete = RUBRIC_CRITERIA.every((c) => scores[c] !== undefined)

  function submit() {
    if (!complete) return
    const trimmed = comment.trim()
    onSubmit({
      expected_revision: draft.revision,
      relevance: scores.relevance!,
      clarity: scores.clarity!,
      personalization: scores.personalization!,
      call_to_action: scores.call_to_action!,
      tone: scores.tone!,
      comment: trimmed === '' ? null : trimmed,
    })
  }

  return (
    <Card title="Reviewer rating" icon="star">
      <p className="small muted">
        Scores feed the evaluation report. Rating does not approve, reject or change the draft.
      </p>

      {draft.message === null ? (
        <p className="small muted">There is no message to rate.</p>
      ) : (
        <form
          className="rating-form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          {RUBRIC_CRITERIA.map((c) => (
            <fieldset key={c} className="rubric-row">
              <legend className="small">{RUBRIC_LABELS[c]}</legend>
              <div className="score-group">
                {SCORES.map((s) => (
                  <label key={s} className={`score ${scores[c] === s ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name={`score-${c}`}
                      value={s}
                      checked={scores[c] === s}
                      onChange={() => setScores((prev) => ({ ...prev, [c]: s }))}
                    />
                    {s}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <label className="form-field">
            <span className="small">Comment (optional)</span>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={2} />
          </label>
          <div className="panel-actions">
            <button type="submit" className="btn-primary" disabled={!complete || busy}>
              {busy ? 'Saving…' : `Save rating for revision ${draft.revision}`}
            </button>
            <span className="small muted">1 = poor, 5 = excellent</span>
          </div>
          {saved && (
            <p className="small text-success" role="status">
              Rating saved.
            </p>
          )}
        </form>
      )}

      {failure && (
        <ErrorBanner
          title="Could not save the rating"
          error={failure.error}
          retry={failure.canRetry ? { onRetry, readyAt: failure.retryReadyAt, disabled: busy } : undefined}
          onDismiss={onDismiss}
        />
      )}

      {ratings.length > 0 && (
        <table className="evidence ratings-table">
          <thead>
            <tr>
              <th scope="col">Rev</th>
              <th scope="col">By</th>
              {RUBRIC_CRITERIA.map((c) => (
                <th key={c} scope="col" title={RUBRIC_LABELS[c]}>
                  {RUBRIC_LABELS[c].split(' ')[0]}
                </th>
              ))}
              <th scope="col">Avg</th>
            </tr>
          </thead>
          <tbody>
            {ratings.map((r) => (
              <tr key={r.rating_id} title={`${formatUtc(r.rated_at)}${r.comment ? ` — ${r.comment}` : ''}`}>
                <td>{r.revision}</td>
                <td className="mono">{r.rated_by}</td>
                {RUBRIC_CRITERIA.map((c) => (
                  <td key={c}>{r[c]}</td>
                ))}
                <td>
                  <strong>{average(r)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
