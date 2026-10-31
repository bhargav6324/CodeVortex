/**
 * Human-readable labels for contract enum values. The raw code is always shown next to
 * the label too, so the reviewer sees exactly what the backend returned.
 * Labels avoid policy numbers on purpose: thresholds are backend configuration.
 */
import type { AuditEventType, RubricCriterion } from '../types/contractV11'
import type {
  BillingStatus,
  DraftStatus,
  EligibilityReason,
  FindingCode,
  Objective,
  ReasonCode,
  ReminderStage,
  SegmentCode,
  SendStatus,
  Tone,
} from '../types/contract'

export const SEGMENT_LABELS: Record<SegmentCode, string> = {
  payment_reminder: 'Payment reminder',
  dormant: 'Dormant',
  declining_activity: 'Declining activity',
  loyalty_candidate: 'Loyalty candidate',
  consistent: 'Consistent payer',
}

export const REASON_LABELS: Record<ReasonCode, string> = {
  TIMELY_PAYMENT: 'Recent payments on time',
  LOYALTY_THRESHOLD: 'Loyalty points and tenure threshold met',
  ACTIVITY_DECLINED: 'Activity has declined',
  NO_RECENT_ACTIVITY: 'No recent activity',
  VERIFIED_OVERDUE: 'Verified overdue bill',
}

export const OBJECTIVE_LABELS: Record<Objective, string> = {
  appreciation: 'Appreciation',
  reward: 'Reward',
  reengagement: 'Re-engagement',
  payment_reminder: 'Payment reminder',
}

export const TONE_LABELS: Record<Tone, string> = {
  warm: 'Warm',
  encouraging: 'Encouraging',
  courteous: 'Courteous',
  firm_respectful: 'Firm but respectful',
}

export const REMINDER_STAGE_LABELS: Record<ReminderStage, string> = {
  none: 'Not a reminder',
  courteous: 'Courteous reminder',
  firm: 'Firm reminder',
}

export type BadgeTone = 'info' | 'success' | 'danger' | 'neutral' | 'warning'

export const STATUS_DISPLAY: Record<DraftStatus, { label: string; tone: BadgeTone }> = {
  ready_for_review: { label: 'Ready for review', tone: 'info' },
  blocked: { label: 'Blocked', tone: 'danger' },
  approved: { label: 'Approved (draft only)', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  mock_sent: { label: 'Mock sent', tone: 'success' },
}

export const SEND_STATUS_LABELS: Record<SendStatus, string> = {
  not_sent: 'Not sent',
  draft_only: 'Approved as draft only (not sent)',
  mock_sent: 'Delivered to the mock outbox',
}

export const BILLING_STATUS_DISPLAY: Record<BillingStatus, { label: string; tone: BadgeTone }> = {
  paid: { label: 'Paid', tone: 'success' },
  current: { label: 'Current', tone: 'info' },
  overdue: { label: 'Overdue', tone: 'warning' },
  disputed: { label: 'Disputed', tone: 'danger' },
  unknown: { label: 'Unknown', tone: 'neutral' },
}

export const FINDING_LABELS: Record<FindingCode, string> = {
  MISSING_EVIDENCE: 'Missing evidence',
  CONTRADICTORY_DATA: 'Contradictory data',
  CONSENT_REQUIRED: 'Consent required',
  CHANNEL_BLOCKED: 'Channel blocked',
  CONTACT_FREQUENCY: 'Contact frequency limit',
  DUPLICATE_OUTREACH: 'Duplicate outreach',
  OFFER_INELIGIBLE: 'Offer not eligible',
  OFFER_EXPIRED: 'Offer expired',
  OFFER_TERMS_MISMATCH: 'Offer terms mismatch',
  BILLING_UNVERIFIED: 'Billing not verified',
  BILLING_DISPUTED: 'Billing disputed',
  UNSUPPORTED_CLAIM: 'Unsupported claim',
  PROHIBITED_LANGUAGE: 'Prohibited language',
  SENSITIVE_DATA: 'Sensitive data',
  POLICY_MISMATCH: 'Policy mismatch',
  MODEL_UNAVAILABLE: 'Model unavailable',
  HUMAN_APPROVAL_REQUIRED: 'Human approval required',
}

// ---------------------------------------------------------------------------
// Proposed v1.1.0
// ---------------------------------------------------------------------------

export const ELIGIBILITY_REASON_LABELS: Record<EligibilityReason, string> = {
  ELIGIBLE: 'Eligible',
  NO_MARKETING_CONSENT: 'No marketing consent',
  PLAN_NOT_ALLOWED: 'Plan not allowed for this offer',
  LOW_LOYALTY: 'Loyalty points below minimum',
  LOW_TENURE: 'Tenure below minimum',
  OFFER_NOT_ACTIVE: 'Offer not active (expired or not started)',
  BILLING_PRIORITY: 'Billing reminder takes priority',
}

export const AUDIT_EVENT_LABELS: Record<AuditEventType, string> = {
  draft_created: 'Draft generated',
  draft_blocked: 'Generation refused (blocked)',
  edited: 'Edited',
  approved: 'Approved (draft only)',
  mock_sent: 'Approved and mock-sent',
  rejected: 'Rejected',
  rated: 'Rated',
}

export const RUBRIC_LABELS: Record<RubricCriterion, string> = {
  relevance: 'Relevance',
  clarity: 'Clarity',
  personalization: 'Personalization',
  call_to_action: 'Call to action',
  tone: 'Tone appropriateness',
}
