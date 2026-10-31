/**
 * Validates JSON against the contract schemas:
 * - src/types/contract.schema.json         frozen v1.0.0, extracted verbatim from the shared contract
 * - src/types/contract-v1.1-ext.schema.json PROPOSED v1.1.0 additions (contracts/PROPOSAL_v1.1.0.md)
 *
 * Used by the dev-only response check in client.ts and by the tests. It is loaded with a
 * dynamic import in the app, so it never ships in a production build.
 */
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import baseSchema from '../types/contract.schema.json'
import extSchema from '../types/contract-v1.1-ext.schema.json'

const BASE = ['Context', 'Draft', 'Health', 'Error', 'DraftRequest', 'ReviewRequest'] as const
const EXT = ['HealthV11', 'RatingRequest', 'Rating', 'DraftDetails'] as const

export type SchemaName = (typeof BASE)[number] | (typeof EXT)[number]

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
ajv.addSchema(baseSchema)
ajv.addSchema(extSchema)

function schemaId(name: SchemaName): string {
  const id = (EXT as readonly string[]).includes(name) ? extSchema.$id : baseSchema.$id
  return `${id}#/$defs/${name}`
}

/** Returns a readable list of problems; an empty list means the data matches the contract. */
export function contractErrors(name: SchemaName, data: unknown): string[] {
  const validate = ajv.getSchema(schemaId(name))
  if (!validate) return [`Unknown schema "${name}"`]
  if (validate(data)) return []
  return (validate.errors ?? []).map((e) => {
    const allowed = (e.params as { allowedValues?: unknown[] }).allowedValues
    const extra = (e.params as { additionalProperty?: string }).additionalProperty
    return `${e.instancePath || '(root)'} ${e.message}${allowed ? `: ${allowed.join(', ')}` : ''}${extra ? ` "${extra}"` : ''}`
  })
}
