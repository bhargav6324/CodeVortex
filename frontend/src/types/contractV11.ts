/**
 * PROPOSED contract v1.1.0 additions (contracts/PROPOSAL_v1.1.0.md).
 * Additive only: the four v1.0.0 endpoints and their schemas are unchanged.
 * The UI uses these only when GET /health reports contract_version "1.1.0".
 */
import type { Eligibility, Id, Timestamp } from './contract'

export const CONTRACT_V11 = '1.1.0'
export const SUPPORTED_CONTRACT_VERSIONS = ['1.0.0', '1.1.0'] as const
export type ContractVersion = (typeof SUPPORTED_CONTRACT_VERSIONS)[number]

/** Reviewer rubric score, 1 (poor) to 5 (excellent). */
export type Score = 1 | 2 | 3 | 4 | 5

export const RUBRIC_CRITERIA = ['relevance', 'clarity', 'personalization', 'call_to_action', 'tone'] as const
export type RubricCriterion = (typeof RUBRIC_CRITERIA)[number]

/** POST /api/v1/drafts/{draft_id}/ratings request body */
export interface RatingRequest {
  expected_revision: number
  relevance: Score
  clarity: Score
  personalization: Score
  call_to_action: Score
  tone: Score
  comment: string | null
}

export interface Rating {
  rating_id: Id
  draft_id: Id
  /** The draft revision that was rated */
  revision: number
  rated_by: Id
  rated_at: Timestamp
  relevance: Score
  clarity: Score
  personalization: Score
  call_to_action: Score
  tone: Score
  comment: string | null
}

export type AuditEventType =
  | 'draft_created'
  | 'draft_blocked'
  | 'edited'
  | 'approved'
  | 'mock_sent'
  | 'rejected'
  | 'rated'

/** Only actions that actually happened are audited; refused reviews write nothing. */
export interface AuditEvent {
  event_id: Id
  draft_id: Id
  revision: number
  event_type: AuditEventType
  actor_id: Id
  request_id: Id
  at: Timestamp
  /** Short, redacted description — no raw customer data */
  summary: string
  /** Names of evidence fields used, never their values */
  evidence_fields: string[]
}

export interface OutboxEntry {
  delivery_id: Id
  draft_id: Id
  customer_id: Id
  campaign_key: Id
  channel: 'email'
  delivery: 'mock_email'
  subject: string
  body: string
  /** SHA-256 of the delivered content, 64 lowercase hex characters */
  content_hash: string
  delivered_at: Timestamp
}

/** GET /api/v1/drafts/{draft_id}/details */
export interface DraftDetails {
  draft_id: Id
  revision: number
  /** Deterministic offer eligibility from the backend's plan. May be empty for drafts
   *  created before the backend started storing it. */
  eligibility: Eligibility[]
  audit: AuditEvent[]
  /** The single mock outbox row, or null if nothing was delivered */
  outbox: OutboxEntry | null
  ratings: Rating[]
}
