/**
 * Shared contract v1.0.0 — TypeScript mirror of the frozen JSON Schema registry
 * (`urn:codevortex:loyalty:1.0.0`) in FRONTEND_CONTRACT.md.
 *
 * Rules:
 * - Field names are copied exactly (snake_case). Do not rename.
 * - Every field is required. `| null` appears only where the schema allows null.
 * - `null` means unknown / not applicable. Never treat it as 0, false or consent.
 * - Money is integer paise (amount_minor). Timestamps are RFC3339 UTC ("...Z"),
 *   dates are "YYYY-MM-DD".
 *
 * A change here requires a new contract version agreed with backend and AI.
 */

export const CONTRACT_VERSION = '1.0.0'

/** Opaque ID matching ^[A-Za-z0-9_-]{1,64}$ */
export type Id = string
/** RFC3339 UTC timestamp, e.g. "2026-10-31T06:00:00Z" */
export type Timestamp = string
/** Calendar date, e.g. "2026-10-20" */
export type IsoDate = string

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type SegmentCode =
  | 'consistent'
  | 'loyalty_candidate'
  | 'declining_activity'
  | 'dormant'
  | 'payment_reminder'

export type ReasonCode =
  | 'TIMELY_PAYMENT'
  | 'LOYALTY_THRESHOLD'
  | 'ACTIVITY_DECLINED'
  | 'NO_RECENT_ACTIVITY'
  | 'VERIFIED_OVERDUE'

export type Objective = 'appreciation' | 'reward' | 'reengagement' | 'payment_reminder'

export type Tone = 'warm' | 'encouraging' | 'courteous' | 'firm_respectful'

export type ReminderStage = 'none' | 'courteous' | 'firm'

export type FindingCode =
  | 'MISSING_EVIDENCE'
  | 'CONTRADICTORY_DATA'
  | 'CONSENT_REQUIRED'
  | 'CHANNEL_BLOCKED'
  | 'CONTACT_FREQUENCY'
  | 'DUPLICATE_OUTREACH'
  | 'OFFER_INELIGIBLE'
  | 'OFFER_EXPIRED'
  | 'OFFER_TERMS_MISMATCH'
  | 'BILLING_UNVERIFIED'
  | 'BILLING_DISPUTED'
  | 'UNSUPPORTED_CLAIM'
  | 'PROHIBITED_LANGUAGE'
  | 'SENSITIVE_DATA'
  | 'POLICY_MISMATCH'
  | 'MODEL_UNAVAILABLE'
  | 'HUMAN_APPROVAL_REQUIRED'

export type Severity = 'block' | 'warning'

export type BillingStatus = 'paid' | 'current' | 'overdue' | 'disputed' | 'unknown'

export type DraftStatus = 'ready_for_review' | 'blocked' | 'approved' | 'rejected' | 'mock_sent'

export type SendStatus = 'not_sent' | 'draft_only' | 'mock_sent'

export type ReviewDecision = 'edit' | 'approve' | 'reject'

export type Delivery = 'draft_only' | 'mock_email'

export type EligibilityReason =
  | 'ELIGIBLE'
  | 'NO_MARKETING_CONSENT'
  | 'PLAN_NOT_ALLOWED'
  | 'LOW_LOYALTY'
  | 'LOW_TENURE'
  | 'OFFER_NOT_ACTIVE'
  | 'BILLING_PRIORITY'

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'REVIEW_BLOCKED'
  | 'INVALID_TRANSITION'
  | 'RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export interface Money {
  /** Non-negative integer paise. 149900 = INR 1499.00 */
  amount_minor: number
  currency: 'INR'
}

export interface Message {
  /** 1–160 chars, plain text */
  subject: string
  /** 1–5000 chars, plain text with \n line breaks */
  body: string
}

export interface Evidence {
  /** Allowlisted field path, e.g. "customer.loyalty_points" */
  field: string
  value: string | number | boolean | null
}

export interface Segment {
  code: SegmentCode
  reason_codes: ReasonCode[]
  /** Rule confidence in [0, 1], not an LLM probability */
  confidence: number
  evidence: Evidence[]
}

export interface Strategy {
  objective: Objective
  tone: Tone
  template_id: Id
  reminder_stage: ReminderStage
}

export interface Finding {
  code: FindingCode
  severity: Severity
  field: string | null
  message: string
}

export interface Validation {
  /** true exactly when there are no `block` findings */
  passed: boolean
  findings: Finding[]
  checked_at: Timestamp
  validator_version: Id
}

export interface Offer {
  offer_id: Id
  title: string
  /** Approved literal terms — display exactly as given */
  terms: string
  terms_version: Id
  value: Money
  valid_from: Timestamp
  expires_at: Timestamp
  channel: 'email'
  min_loyalty_points: number
  min_tenure_months: number
  allowed_plans: Id[]
  requires_marketing_consent: boolean
}

/** Deterministic eligibility result for one offer (part of the backend's Plan). */
export interface Eligibility {
  offer_id: Id
  eligible: boolean
  reason_codes: EligibilityReason[]
}

export interface Customer {
  customer_id: Id
  display_name: string
  active_plan: Id
  tenure_months: number
  loyalty_points: number
  activity_current_30d: number | null
  activity_previous_30d: number | null
  last_activity_at: Timestamp | null
  /** 0–3, null = unknown */
  timely_payments_last_3: number | null
}

export interface Consent {
  email_allowed: boolean
  marketing_opt_in: boolean
  service_email_allowed: boolean
  recorded_at: Timestamp
  source: string
}

export interface Billing {
  bill_id: Id | null
  status: BillingStatus
  amount_due: Money | null
  due_date: IsoDate | null
  verified_at: Timestamp | null
  dispute_open: boolean
  support_text: string
}

export interface Contact {
  contact_id: Id
  customer_id: Id
  campaign_key: Id
  channel: 'email'
  sent_at: Timestamp
  delivery: 'mock_email'
}

export interface Versions {
  policy_version: Id
  template_version: Id
  prompt_version: Id
  model_version: string
  data_version: Id
}

// ---------------------------------------------------------------------------
// Top-level API bodies used by the browser
// ---------------------------------------------------------------------------

/** GET /api/v1/customers/{customer_id}/context */
export interface Context {
  customer: Customer
  consent: Consent
  billing: Billing
  contacts: Contact[]
  offers: Offer[]
  data_version: Id
  as_of: Timestamp
}

/** POST /api/v1/drafts request body */
export interface DraftRequest {
  customer_id: Id
  channel: 'email'
  locale: 'en-IN'
}

/** Response of POST /api/v1/drafts, GET /api/v1/drafts/{id} and POST .../review */
export interface Draft {
  draft_id: Id
  customer_id: Id
  revision: number
  status: DraftStatus
  segments: Segment[]
  strategy: Strategy | null
  selected_offer_id: Id | null
  message: Message | null
  evidence: Evidence[]
  validation: Validation
  versions: Versions
  campaign_key: Id
  created_at: Timestamp
  updated_at: Timestamp
  approved_by: Id | null
  approved_at: Timestamp | null
  send_status: SendStatus
  delivery_id: Id | null
  feedback: string | null
  request_id: Id
}

/**
 * POST /api/v1/drafts/{draft_id}/review request body.
 * Allowed combinations:
 * - edit:    edited_message = Message, delivery = 'draft_only'
 * - approve: edited_message = null,    delivery = 'draft_only' | 'mock_email'
 * - reject:  edited_message = null,    delivery = 'draft_only'
 */
export interface ReviewRequest {
  expected_revision: number
  decision: ReviewDecision
  edited_message: Message | null
  /** null or 1–1000 chars */
  feedback: string | null
  delivery: Delivery
}

/** GET /health */
export interface Health {
  status: 'ok'
  service: 'backend'
  /** "1.0.0" in the frozen contract; "1.1.0" if the backend adopts the proposed extension. */
  contract_version: '1.0.0' | '1.1.0'
}

/** Body of every non-success response */
export interface ErrorBody {
  error: {
    code: ErrorCode
    message: string
    request_id: Id
    retryable: boolean
    details: { field: string | null; reason: string }[]
  }
}
