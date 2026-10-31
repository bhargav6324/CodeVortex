import type { Validation } from '../../../types/contract'
import { formatUtc } from '../../../utils/format'
import { FINDING_LABELS } from '../../../utils/labels'
import { Icon } from '../icons'
import { Badge, Card, Code } from '../ui'

/** The backend's validation result. Block findings are listed before warnings. */
export function ValidationList({ validation }: { validation: Validation }) {
  const findings = [...validation.findings].sort(
    (a, b) => Number(b.severity === 'block') - Number(a.severity === 'block'),
  )
  return (
    <Card
      title="Validation"
      icon="shieldCheck"
      actions={
        <Badge tone={validation.passed ? 'success' : 'danger'} icon={validation.passed ? 'check' : 'x'}>
          {validation.passed ? 'Passed' : 'Failed'}
        </Badge>
      }
    >
      {findings.length === 0 ? (
        <p className="all-clear">
          <Icon name="shieldCheck" size={18} />
          No findings. Every check passed.
        </p>
      ) : (
        <ul className="findings">
          {findings.map((f, i) => (
            <li key={i} className={`finding finding-${f.severity}`}>
              <div className="finding-head">
                <Badge tone={f.severity === 'block' ? 'danger' : 'warning'}>
                  {f.severity === 'block' ? 'Block' : 'Warning'}
                </Badge>
                <strong>{FINDING_LABELS[f.code]}</strong>
                <Code>{f.code}</Code>
              </div>
              <p>{f.message}</p>
              {f.field !== null && <p className="muted small mono">{f.field}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Checked {formatUtc(validation.checked_at)} · <span className="mono">{validation.validator_version}</span>
      </p>
    </Card>
  )
}
