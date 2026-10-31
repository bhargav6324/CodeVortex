# Generated from contracts/schema.json by scripts/extract_contract.py.
# Do not change DTO fields independently of the frozen contract.
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, List, Literal, Union

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, RootModel, model_validator


def valid_utc(value: str) -> str:
    if not value.endswith("Z"):
        raise ValueError("Timestamp must use UTC Z")
    datetime.fromisoformat(value[:-1] + "+00:00")
    return value


def valid_date(value: str) -> str:
    date.fromisoformat(value)
    return value


UTCString = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$"), AfterValidator(valid_utc)]
DateString = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$"), AfterValidator(valid_date)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)



class Money(ContractModel):
    amount_minor: Annotated[int, Field(ge=0)]
    currency: Literal['INR']


class Message(ContractModel):
    subject: Annotated[str, Field(min_length=1, max_length=160)]
    body: Annotated[str, Field(min_length=1, max_length=5000)]


class Evidence(ContractModel):
    field: Annotated[str, Field(min_length=1, max_length=200)]
    value: Union[str, float, bool, None]


class Segment(ContractModel):
    code: Literal['consistent', 'loyalty_candidate', 'declining_activity', 'dormant', 'payment_reminder']
    reason_codes: Annotated[List[Literal['TIMELY_PAYMENT', 'LOYALTY_THRESHOLD', 'ACTIVITY_DECLINED', 'NO_RECENT_ACTIVITY', 'VERIFIED_OVERDUE']], Field(max_length=5)]
    confidence: Annotated[float, Field(ge=0, le=1)]
    evidence: Annotated[List[Evidence], Field(max_length=20)]


class Strategy(ContractModel):
    objective: Literal['appreciation', 'reward', 'reengagement', 'payment_reminder']
    tone: Literal['warm', 'encouraging', 'courteous', 'firm_respectful']
    template_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    reminder_stage: Literal['none', 'courteous', 'firm']


class Finding(ContractModel):
    code: Literal['MISSING_EVIDENCE', 'CONTRADICTORY_DATA', 'CONSENT_REQUIRED', 'CHANNEL_BLOCKED', 'CONTACT_FREQUENCY', 'DUPLICATE_OUTREACH', 'OFFER_INELIGIBLE', 'OFFER_EXPIRED', 'OFFER_TERMS_MISMATCH', 'BILLING_UNVERIFIED', 'BILLING_DISPUTED', 'UNSUPPORTED_CLAIM', 'PROHIBITED_LANGUAGE', 'SENSITIVE_DATA', 'POLICY_MISMATCH', 'MODEL_UNAVAILABLE', 'HUMAN_APPROVAL_REQUIRED']
    severity: Literal['block', 'warning']
    field: Union[Annotated[str, Field(min_length=1, max_length=200)], None]
    message: Annotated[str, Field(min_length=1, max_length=500)]


class Validation(ContractModel):
    passed: bool
    findings: Annotated[List[Finding], Field(max_length=30)]
    checked_at: UTCString
    validator_version: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]


class Offer(ContractModel):
    offer_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    title: Annotated[str, Field(min_length=1, max_length=160)]
    terms: Annotated[str, Field(min_length=1, max_length=2000)]
    terms_version: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    value: Money
    valid_from: UTCString
    expires_at: UTCString
    channel: Literal['email']
    min_loyalty_points: Annotated[int, Field(ge=0)]
    min_tenure_months: Annotated[int, Field(ge=0)]
    allowed_plans: Annotated[List[Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]], Field(max_length=20)]
    requires_marketing_consent: bool


class Customer(ContractModel):
    customer_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    display_name: Annotated[str, Field(min_length=1, max_length=100)]
    active_plan: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    tenure_months: Annotated[int, Field(ge=0)]
    loyalty_points: Annotated[int, Field(ge=0)]
    activity_current_30d: Union[Annotated[int, Field(ge=0)], None]
    activity_previous_30d: Union[Annotated[int, Field(ge=0)], None]
    last_activity_at: Union[UTCString, None]
    timely_payments_last_3: Union[Annotated[int, Field(ge=0, le=3)], None]


class Consent(ContractModel):
    email_allowed: bool
    marketing_opt_in: bool
    service_email_allowed: bool
    recorded_at: UTCString
    source: Annotated[str, Field(min_length=1, max_length=100)]


class Billing(ContractModel):
    bill_id: Union[Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')], None]
    status: Literal['paid', 'current', 'overdue', 'disputed', 'unknown']
    amount_due: Union[Money, None]
    due_date: Union[DateString, None]
    verified_at: Union[UTCString, None]
    dispute_open: bool
    support_text: Annotated[str, Field(min_length=1, max_length=300)]


class Contact(ContractModel):
    contact_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    customer_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    campaign_key: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    channel: Literal['email']
    sent_at: UTCString
    delivery: Literal['mock_email']


class Context(ContractModel):
    customer: Customer
    consent: Consent
    billing: Billing
    contacts: Annotated[List[Contact], Field(max_length=100)]
    offers: Annotated[List[Offer], Field(max_length=20)]
    data_version: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    as_of: UTCString


class PolicyTemplatesItem(ContractModel):
    template_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    objective: Literal['appreciation', 'reward', 'reengagement', 'payment_reminder']
    tone: Literal['warm', 'encouraging', 'courteous', 'firm_respectful']
    subject: Annotated[str, Field(min_length=1, max_length=160)]
    body: Annotated[str, Field(min_length=1, max_length=5000)]


class Policy(ContractModel):
    policy_version: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    template_version: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    loyalty_points_threshold: Annotated[int, Field(ge=0)]
    loyalty_tenure_months: Annotated[int, Field(ge=0)]
    decline_ratio: Annotated[float, Field(ge=0, le=1)]
    dormant_days: Annotated[int, Field(ge=0)]
    firm_after_days: Annotated[int, Field(ge=0)]
    max_contacts_7d: Annotated[int, Field(ge=0)]
    dedupe_days: Annotated[int, Field(ge=0)]
    billing_max_age_hours: Annotated[int, Field(ge=0)]
    required_disclaimer: Annotated[str, Field(min_length=1, max_length=500)]
    blocked_phrases: Annotated[List[Annotated[str, Field(min_length=1, max_length=100)]], Field(max_length=100)]
    templates: Annotated[List[PolicyTemplatesItem], Field(max_length=10)]


class Eligibility(ContractModel):
    offer_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    eligible: bool
    reason_codes: Annotated[List[Literal['ELIGIBLE', 'NO_MARKETING_CONSENT', 'PLAN_NOT_ALLOWED', 'LOW_LOYALTY', 'LOW_TENURE', 'OFFER_NOT_ACTIVE', 'BILLING_PRIORITY']], Field(max_length=10)]


class Plan(ContractModel):
    segments: Annotated[List[Segment], Field(max_length=5)]
    strategy: Union[Strategy, None]
    selected_offer_id: Union[Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')], None]
    eligibility: Annotated[List[Eligibility], Field(max_length=20)]
    validation: Validation
    campaign_key: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]


class Versions(ContractModel):
    policy_version: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    template_version: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    prompt_version: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    model_version: Annotated[str, Field(min_length=1, max_length=200)]
    data_version: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]


class DraftRequest(ContractModel):
    customer_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    channel: Literal['email']
    locale: Literal['en-IN']


class Draft(ContractModel):
    draft_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    customer_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    revision: Annotated[int, Field(ge=1)]
    status: Literal['ready_for_review', 'blocked', 'approved', 'rejected', 'mock_sent']
    segments: Annotated[List[Segment], Field(max_length=5)]
    strategy: Union[Strategy, None]
    selected_offer_id: Union[Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')], None]
    message: Union[Message, None]
    evidence: Annotated[List[Evidence], Field(max_length=40)]
    validation: Validation
    versions: Versions
    campaign_key: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    created_at: UTCString
    updated_at: UTCString
    approved_by: Union[Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')], None]
    approved_at: Union[UTCString, None]
    send_status: Literal['not_sent', 'draft_only', 'mock_sent']
    delivery_id: Union[Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')], None]
    feedback: Union[Annotated[str, Field(min_length=1, max_length=1000)], None]
    request_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]


class ReviewRequest(ContractModel):
    expected_revision: Annotated[int, Field(ge=1)]
    decision: Literal['edit', 'approve', 'reject']
    edited_message: Union[Message, None]
    feedback: Union[Annotated[str, Field(min_length=1, max_length=1000)], None]
    delivery: Literal['draft_only', 'mock_email']

    @model_validator(mode="after")
    def check_combination(self):
        if self.decision == "edit":
            if self.edited_message is None or self.delivery != "draft_only":
                raise ValueError("Edit requires edited_message and draft_only delivery")
        elif self.edited_message is not None:
            raise ValueError("Approve and reject require edited_message=null")
        if self.decision == "reject" and self.delivery != "draft_only":
            raise ValueError("Reject requires draft_only delivery")
        return self


class Health(ContractModel):
    status: Literal['ok']
    service: Literal['backend']
    contract_version: Literal['1.0.0']


class AIRequest(ContractModel):
    turn_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    customer_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    as_of: UTCString
    context: Context
    policy: Policy
    locale: Literal['en-IN']


class AIResponse(ContractModel):
    turn_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    plan: Plan
    message: Union[Message, None]
    evidence: Annotated[List[Evidence], Field(max_length=40)]
    generation_status: Literal['generated', 'blocked', 'unavailable']
    prompt_version: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    model_version: Annotated[str, Field(min_length=1, max_length=200)]


class EvaluateToolRequestArguments(ContractModel):
    customer_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]


class EvaluateToolRequest(ContractModel):
    tool: Literal['evaluate_customer']
    turn_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    arguments: EvaluateToolRequestArguments


class ValidateToolRequestArguments(ContractModel):
    customer_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    message: Message
    selected_offer_id: Union[Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')], None]
    template_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]


class ValidateToolRequest(ContractModel):
    tool: Literal['validate_draft']
    turn_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    arguments: ValidateToolRequestArguments


class ToolRequest(RootModel[Union[EvaluateToolRequest, ValidateToolRequest]]):
    model_config = ConfigDict(strict=True)


class EvaluateToolResponse(ContractModel):
    tool: Literal['evaluate_customer']
    turn_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    result: Plan


class ValidateToolResponse(ContractModel):
    tool: Literal['validate_draft']
    turn_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    result: Validation


class ToolResponse(RootModel[Union[EvaluateToolResponse, ValidateToolResponse]]):
    model_config = ConfigDict(strict=True)


class ErrorErrorDetailsItem(ContractModel):
    field: Union[Annotated[str, Field(min_length=1, max_length=200)], None]
    reason: Annotated[str, Field(min_length=1, max_length=500)]


class ErrorError(ContractModel):
    code: Literal['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_REQUEST', 'IDEMPOTENCY_CONFLICT', 'VERSION_CONFLICT', 'REVIEW_BLOCKED', 'INVALID_TRANSITION', 'RATE_LIMITED', 'AI_TIMEOUT', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR']
    message: Annotated[str, Field(min_length=1, max_length=500)]
    request_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    retryable: bool
    details: Annotated[List[ErrorErrorDetailsItem], Field(max_length=20)]


class Error(ContractModel):
    error: ErrorError


class DatasetLabelsItem(ContractModel):
    customer_id: Annotated[str, Field(pattern='^[A-Za-z0-9_-]{1,64}$')]
    expected_segments: Annotated[List[Literal['consistent', 'loyalty_candidate', 'declining_activity', 'dormant', 'payment_reminder']], Field(max_length=5)]
    expected_objective: Union[Literal['appreciation', 'reward', 'reengagement', 'payment_reminder'], None]
    expected_block_codes: Annotated[List[Annotated[str, Field(min_length=1, max_length=100)]], Field(max_length=20)]


class Dataset(ContractModel):
    schema_version: Literal['1.0.0']
    as_of: UTCString
    customers: Annotated[List[Context], Field(max_length=1000)]
    policy: Policy
    labels: Annotated[List[DatasetLabelsItem], Field(max_length=1000)]
