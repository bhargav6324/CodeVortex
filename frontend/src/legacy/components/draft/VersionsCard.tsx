import type { Versions } from '../../../types/contract'
import { Card, Field, Fields } from '../ui'

/** Audit versions for this draft (policy, template, prompt, model, data). */
export function VersionsCard({ versions }: { versions: Versions }) {
  const model =
    versions.model_version === 'not_invoked' ? 'not_invoked (AI model was not called)' : versions.model_version
  return (
    <Card title="Versions" icon="code">
      <Fields>
        <Field label="Policy" value={versions.policy_version} mono />
        <Field label="Template" value={versions.template_version} mono />
        <Field label="Prompt" value={versions.prompt_version} mono />
        <Field label="Model" value={model} mono />
        <Field label="Data" value={versions.data_version} mono />
      </Fields>
    </Card>
  )
}
