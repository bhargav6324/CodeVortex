"""Load trusted synthetic seed files; reject structural/referential corruption."""
from datetime import date, datetime
from pathlib import Path
from typing import List, Optional, Tuple

from pydantic import TypeAdapter, ValidationError

from app.models import Dataset, Draft


class FixtureError(ValueError):
    """Safe startup error; never includes customer records or validation inputs."""


def instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def validate_dataset(dataset: Dataset) -> None:
    customers = set()
    contacts = set()
    offers = {}
    as_of = instant(dataset.as_of)
    for context in dataset.customers:
        customer = context.customer
        if customer.customer_id in customers or context.as_of != dataset.as_of:
            raise FixtureError('Duplicate customer ID or mismatched reference clock.')
        customers.add(customer.customer_id)
        for timestamp in [customer.last_activity_at, context.consent.recorded_at, context.billing.verified_at]:
            if timestamp is not None and instant(timestamp) > as_of:
                raise FixtureError('Observed customer timestamps cannot be in the future.')
        bill = context.billing
        amount = bill.amount_due.amount_minor if bill.amount_due else None
        if bill.status == 'paid' and (amount != 0 or bill.dispute_open):
            raise FixtureError('Paid billing record is inconsistent.')
        if bill.status == 'current' and (amount is None or amount <= 0 or bill.due_date is None or date.fromisoformat(bill.due_date) < as_of.date() or bill.dispute_open):
            raise FixtureError('Current billing record is inconsistent.')
        if bill.status == 'overdue' and (not bill.bill_id or amount is None or amount <= 0 or bill.due_date is None or date.fromisoformat(bill.due_date) >= as_of.date() or bill.verified_at is None or bill.dispute_open):
            raise FixtureError('Overdue billing record is inconsistent.')
        if bill.status == 'disputed' and not bill.dispute_open:
            raise FixtureError('Disputed billing record needs an open dispute.')
        if bill.status == 'unknown' and any(value is not None for value in [bill.amount_due, bill.due_date, bill.verified_at]):
            raise FixtureError('Unknown billing must preserve unknown values.')
        for contact in context.contacts:
            if contact.contact_id in contacts or contact.customer_id != customer.customer_id or instant(contact.sent_at) > as_of:
                raise FixtureError('Contact identity, relationship or timestamp is invalid.')
            contacts.add(contact.contact_id)
        local_offers = set()
        for offer in context.offers:
            if offer.offer_id in local_offers or instant(offer.valid_from) >= instant(offer.expires_at):
                raise FixtureError('Offer identity or date window is invalid.')
            local_offers.add(offer.offer_id)
            value = offer.model_dump(mode='json')
            if offer.offer_id in offers and offers[offer.offer_id] != value:
                raise FixtureError('Repeated offer IDs must have identical approved definitions.')
            offers[offer.offer_id] = value
    labels = set()
    for label in dataset.labels:
        if label.customer_id not in customers or label.customer_id in labels or len(set(label.expected_segments)) != len(label.expected_segments):
            raise FixtureError('Evaluation label relationship or segment set is invalid.')
        labels.add(label.customer_id)
    template_ids = [template.template_id for template in dataset.policy.templates]
    if len(set(template_ids)) != len(template_ids):
        raise FixtureError('Template IDs must be unique.')


def validate_draft_shape(draft: Draft) -> None:
    blocked = any(finding.severity == 'block' for finding in draft.validation.findings)
    if draft.validation.passed == blocked:
        raise FixtureError('Draft validation summary is inconsistent.')
    if draft.status == 'blocked' and not blocked:
        raise FixtureError('Blocked draft needs a blocking finding.')
    if draft.status in ('ready_for_review', 'approved', 'mock_sent') and (blocked or draft.message is None or draft.strategy is None):
        raise FixtureError('Deliverable draft needs validated message and strategy.')
    approved = draft.status in ('approved', 'mock_sent')
    if approved != (draft.approved_by is not None and draft.approved_at is not None):
        raise FixtureError('Draft approval metadata is inconsistent.')
    if not approved and (draft.approved_by is not None or draft.approved_at is not None):
        raise FixtureError('Unapproved draft cannot have approval metadata.')
    expected_send = {'approved': 'draft_only', 'mock_sent': 'mock_sent'}.get(draft.status, 'not_sent')
    if draft.send_status != expected_send or (draft.delivery_id is not None) != (draft.status == 'mock_sent'):
        raise FixtureError('Draft send metadata is inconsistent.')
    if instant(draft.updated_at) < instant(draft.created_at):
        raise FixtureError('Draft update cannot precede creation.')


def load_fixtures(dataset_path: Path, drafts_path: Optional[Path]) -> Tuple[Dataset, List[Draft]]:
    try:
        dataset = Dataset.model_validate_json(dataset_path.read_text(encoding='utf-8'))
        validate_dataset(dataset)
        drafts = TypeAdapter(List[Draft]).validate_json(drafts_path.read_text(encoding='utf-8')) if drafts_path else []
        contexts = {item.customer.customer_id: item for item in dataset.customers}
        seen = set()
        for draft in drafts:
            validate_draft_shape(draft)
            context = contexts.get(draft.customer_id)
            if draft.draft_id in seen or context is None:
                raise FixtureError('Seed draft identity or customer relationship is invalid.')
            if draft.status not in ('ready_for_review', 'blocked') or draft.revision != 1:
                raise FixtureError('Seed drafts must be unapproved initial review fixtures.')
            if (draft.versions.data_version != context.data_version or draft.versions.policy_version != dataset.policy.policy_version or draft.versions.template_version != dataset.policy.template_version):
                raise FixtureError('Seed draft snapshot versions do not match the dataset.')
            seen.add(draft.draft_id)
        return dataset, drafts
    except FixtureError:
        raise
    except (OSError, ValueError, ValidationError):
        raise FixtureError('Cannot load dataset/draft fixtures; check files against the frozen schema.') from None
