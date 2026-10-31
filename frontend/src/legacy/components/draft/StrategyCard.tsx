import type { Strategy } from '../../../types/contract'
import { OBJECTIVE_LABELS, REMINDER_STAGE_LABELS, TONE_LABELS } from '../../../utils/labels'
import { Card, Code, Field, Fields } from '../ui'

/** The policy strategy the backend selected. React never picks or changes it. */
export function StrategyCard({ strategy }: { strategy: Strategy | null }) {
  return (
    <Card title="Strategy" icon="target">
      {strategy === null ? (
        <p className="muted small">No strategy was selected. The backend blocked this draft before choosing one.</p>
      ) : (
        <Fields>
          <Field label="Objective" value={<>{OBJECTIVE_LABELS[strategy.objective]} <Code>{strategy.objective}</Code></>} />
          <Field label="Tone" value={<>{TONE_LABELS[strategy.tone]} <Code>{strategy.tone}</Code></>} />
          <Field label="Template" value={strategy.template_id} mono />
          <Field
            label="Reminder stage"
            value={<>{REMINDER_STAGE_LABELS[strategy.reminder_stage]} <Code>{strategy.reminder_stage}</Code></>}
          />
        </Fields>
      )}
    </Card>
  )
}
