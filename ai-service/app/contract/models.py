"""Pydantic models for shared contract v1.0.0 (urn:codevortex:loyalty:1.0.0).

Mirrors ai-service/contract/schema-1.0.0.json exactly: every object is closed,
every property is required, and null is accepted only where the schema allows it.
Do not change field names, enums or limits here without a new contract version.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Annotated, Literal, Union

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    StringConstraints,
)

CONTRACT_VERSION = "1.0.0"

ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"


def _require_utc(value: datetime) -> datetime:
    if value.utcoffset() != timedelta(0):
        raise ValueError("timestamp must be UTC (Z)")
    return value


def _no_numbers(value: object) -> object:
    # Lax mode would accept Unix timestamps; the contract only allows ISO strings.
    if isinstance(value, (int, float)):
        raise ValueError("expected an ISO 8601 string")
    return value


Id = Annotated[StrictStr, StringConstraints(pattern=ID_PATTERN)]
UtcDatetime = Annotated[AwareDatetime, BeforeValidator(_no_numbers), AfterValidator(_require_utc)]
IsoDate = Annotated[date, BeforeValidator(_no_numbers)]
NonNegInt = Annotated[StrictInt, Field(ge=0)]
Unit = Annotated[StrictFloat, Field(ge=0, le=1)]
FieldName = Annotated[StrictStr, StringConstraints(min_length=1, max_length=200)]

SegmentCode = Literal["consistent", "loyalty_candidate", "declining_activity", "dormant", "payment_reminder"]
ReasonCode = Literal["TIMELY_PAYMENT", "LOYALTY_THRESHOLD", "ACTIVITY_DECLINED", "NO_RECENT_ACTIVITY", "VERIFIED_OVERDUE"]
Objective = Literal["appreciation", "reward", "reengagement", "payment_reminder"]
Tone = Literal["warm", "encouraging", "courteous", "firm_respectful"]
FindingCode = Literal[
    "MISSING_EVIDENCE",
    "CONTRADICTORY_DATA",
    "CONSENT_REQUIRED",
    "CHANNEL_BLOCKED",
    "CONTACT_FREQUENCY",
    "DUPLICATE_OUTREACH",
    "OFFER_INELIGIBLE",
    "OFFER_EXPIRED",
    "OFFER_TERMS_MISMATCH",
    "BILLING_UNVERIFIED",
    "BILLING_DISPUTED",
    "UNSUPPORTED_CLAIM",
    "PROHIBITED_LANGUAGE",
    "SENSITIVE_DATA",
    "POLICY_MISMATCH",
    "MODEL_UNAVAILABLE",
    "HUMAN_APPROVAL_REQUIRED",
]
EligibilityReason = Literal[
    "ELIGIBLE",
    "NO_MARKETING_CONSENT",
    "PLAN_NOT_ALLOWED",
    "LOW_LOYALTY",
    "LOW_TENURE",
    "OFFER_NOT_ACTIVE",
    "BILLING_PRIORITY",
]
ErrorCode = Literal[
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "INVALID_REQUEST",
    "IDEMPOTENCY_CONFLICT",
    "VERSION_CONFLICT",
    "REVIEW_BLOCKED",
    "INVALID_TRANSITION",
    "RATE_LIMITED",
    "AI_TIMEOUT",
    "SERVICE_UNAVAILABLE",
    "INTERNAL_ERROR",
]
GenerationStatus = Literal["generated", "blocked", "unavailable"]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Money(ContractModel):
    amount_minor: NonNegInt
    currency: Literal["INR"]


class Message(ContractModel):
    subject: Annotated[StrictStr, StringConstraints(min_length=1, max_length=160)]
    body: Annotated[StrictStr, StringConstraints(min_length=1, max_length=5000)]


class Evidence(ContractModel):
    field: FieldName
    # Smart-mode union keeps ints as ints and bools as bools.
    value: Union[StrictStr, StrictBool, StrictInt, StrictFloat, None]


class Segment(ContractModel):
    code: SegmentCode
    reason_codes: Annotated[list[ReasonCode], Field(max_length=5)]
    confidence: Unit
    evidence: Annotated[list[Evidence], Field(max_length=20)]


class Strategy(ContractModel):
    objective: Objective
    tone: Tone
    template_id: Id
    reminder_stage: Literal["none", "courteous", "firm"]


class Finding(ContractModel):
    code: FindingCode
    severity: Literal["block", "warning"]
    field: FieldName | None
    message: Annotated[StrictStr, StringConstraints(min_length=1, max_length=500)]


class Validation(ContractModel):
    passed: StrictBool
    findings: Annotated[list[Finding], Field(max_length=30)]
    checked_at: UtcDatetime
    validator_version: Id


class Offer(ContractModel):
    offer_id: Id
    title: Annotated[StrictStr, StringConstraints(min_length=1, max_length=160)]
    terms: Annotated[StrictStr, StringConstraints(min_length=1, max_length=2000)]
    terms_version: Id
    value: Money
    valid_from: UtcDatetime
    expires_at: UtcDatetime
    channel: Literal["email"]
    min_loyalty_points: NonNegInt
    min_tenure_months: NonNegInt
    allowed_plans: Annotated[list[Id], Field(max_length=20)]
    requires_marketing_consent: StrictBool


class Customer(ContractModel):
    customer_id: Id
    display_name: Annotated[StrictStr, StringConstraints(min_length=1, max_length=100)]
    active_plan: Id
    tenure_months: NonNegInt
    loyalty_points: NonNegInt
    activity_current_30d: NonNegInt | None
    activity_previous_30d: NonNegInt | None
    last_activity_at: UtcDatetime | None
    timely_payments_last_3: Annotated[StrictInt, Field(ge=0, le=3)] | None


class Consent(ContractModel):
    email_allowed: StrictBool
    marketing_opt_in: StrictBool
    service_email_allowed: StrictBool
    recorded_at: UtcDatetime
    source: Annotated[StrictStr, StringConstraints(min_length=1, max_length=100)]


class Billing(ContractModel):
    bill_id: Id | None
    status: Literal["paid", "current", "overdue", "disputed", "unknown"]
    amount_due: Money | None
    due_date: IsoDate | None
    verified_at: UtcDatetime | None
    dispute_open: StrictBool
    support_text: Annotated[StrictStr, StringConstraints(min_length=1, max_length=300)]


class Contact(ContractModel):
    contact_id: Id
    customer_id: Id
    campaign_key: Id
    channel: Literal["email"]
    sent_at: UtcDatetime
    delivery: Literal["mock_email"]


class Context(ContractModel):
    customer: Customer
    consent: Consent
    billing: Billing
    contacts: Annotated[list[Contact], Field(max_length=100)]
    offers: Annotated[list[Offer], Field(max_length=20)]
    data_version: Id
    as_of: UtcDatetime


class Template(ContractModel):
    template_id: Id
    objective: Objective
    tone: Tone
    subject: Annotated[StrictStr, StringConstraints(min_length=1, max_length=160)]
    body: Annotated[StrictStr, StringConstraints(min_length=1, max_length=5000)]


class Policy(ContractModel):
    policy_version: Id
    template_version: Id
    loyalty_points_threshold: NonNegInt
    loyalty_tenure_months: NonNegInt
    decline_ratio: Unit
    dormant_days: NonNegInt
    firm_after_days: NonNegInt
    max_contacts_7d: NonNegInt
    dedupe_days: NonNegInt
    billing_max_age_hours: NonNegInt
    required_disclaimer: Annotated[StrictStr, StringConstraints(min_length=1, max_length=500)]
    blocked_phrases: Annotated[
        list[Annotated[StrictStr, StringConstraints(min_length=1, max_length=100)]], Field(max_length=100)
    ]
    templates: Annotated[list[Template], Field(max_length=10)]


class Eligibility(ContractModel):
    offer_id: Id
    eligible: StrictBool
    reason_codes: Annotated[list[EligibilityReason], Field(max_length=10)]


class Plan(ContractModel):
    segments: Annotated[list[Segment], Field(max_length=5)]
    strategy: Strategy | None
    selected_offer_id: Id | None
    eligibility: Annotated[list[Eligibility], Field(max_length=20)]
    validation: Validation
    campaign_key: Id


class Versions(ContractModel):
    policy_version: Id
    template_version: Id
    prompt_version: Id
    model_version: Annotated[StrictStr, StringConstraints(min_length=1, max_length=200)]
    data_version: Id


class DraftRequest(ContractModel):
    customer_id: Id
    channel: Literal["email"]
    locale: Literal["en-IN"]


class Draft(ContractModel):
    draft_id: Id
    customer_id: Id
    revision: Annotated[StrictInt, Field(ge=1)]
    status: Literal["ready_for_review", "blocked", "approved", "rejected", "mock_sent"]
    segments: Annotated[list[Segment], Field(max_length=5)]
    strategy: Strategy | None
    selected_offer_id: Id | None
    message: Message | None
    evidence: Annotated[list[Evidence], Field(max_length=40)]
    validation: Validation
    versions: Versions
    campaign_key: Id
    created_at: UtcDatetime
    updated_at: UtcDatetime
    approved_by: Id | None
    approved_at: UtcDatetime | None
    send_status: Literal["not_sent", "draft_only", "mock_sent"]
    delivery_id: Id | None
    feedback: Annotated[StrictStr, StringConstraints(min_length=1, max_length=1000)] | None
    request_id: Id


class ReviewRequest(ContractModel):
    expected_revision: Annotated[StrictInt, Field(ge=1)]
    decision: Literal["edit", "approve", "reject"]
    edited_message: Message | None
    feedback: Annotated[StrictStr, StringConstraints(min_length=1, max_length=1000)] | None
    delivery: Literal["draft_only", "mock_email"]


class AIRequest(ContractModel):
    turn_id: Id
    customer_id: Id
    as_of: UtcDatetime
    context: Context
    policy: Policy
    locale: Literal["en-IN"]


class AIResponse(ContractModel):
    turn_id: Id
    plan: Plan
    message: Message | None
    evidence: Annotated[list[Evidence], Field(max_length=40)]
    generation_status: GenerationStatus
    prompt_version: Id
    model_version: Annotated[StrictStr, StringConstraints(min_length=1, max_length=200)]


class EvaluateArguments(ContractModel):
    customer_id: Id


class EvaluateToolRequest(ContractModel):
    tool: Literal["evaluate_customer"]
    turn_id: Id
    arguments: EvaluateArguments


class ValidateArguments(ContractModel):
    customer_id: Id
    message: Message
    selected_offer_id: Id | None
    template_id: Id


class ValidateToolRequest(ContractModel):
    tool: Literal["validate_draft"]
    turn_id: Id
    arguments: ValidateArguments


class EvaluateToolResponse(ContractModel):
    tool: Literal["evaluate_customer"]
    turn_id: Id
    result: Plan


class ValidateToolResponse(ContractModel):
    tool: Literal["validate_draft"]
    turn_id: Id
    result: Validation


ToolRequest = Annotated[Union[EvaluateToolRequest, ValidateToolRequest], Field(discriminator="tool")]
ToolResponse = Annotated[Union[EvaluateToolResponse, ValidateToolResponse], Field(discriminator="tool")]


class ErrorDetail(ContractModel):
    field: FieldName | None
    reason: Annotated[StrictStr, StringConstraints(min_length=1, max_length=500)]


class ErrorBody(ContractModel):
    code: ErrorCode
    message: Annotated[StrictStr, StringConstraints(min_length=1, max_length=500)]
    request_id: Id
    retryable: StrictBool
    details: Annotated[list[ErrorDetail], Field(max_length=20)]


class Error(ContractModel):
    error: ErrorBody


class DatasetLabel(ContractModel):
    customer_id: Id
    expected_segments: Annotated[list[SegmentCode], Field(max_length=5)]
    expected_objective: Objective | None
    expected_block_codes: Annotated[
        list[Annotated[StrictStr, StringConstraints(min_length=1, max_length=100)]], Field(max_length=20)
    ]


class Dataset(ContractModel):
    schema_version: Literal["1.0.0"]
    as_of: UtcDatetime
    customers: Annotated[list[Context], Field(max_length=1000)]
    policy: Policy
    labels: Annotated[list[DatasetLabel], Field(max_length=1000)]
