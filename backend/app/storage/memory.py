"""Single-process development adapter with copy isolation and rollback by default.

Not durable and not shared across workers. It has no network/email side effects.
"""
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Callable, Dict, List, Optional

from app.models import Contact, Context, Dataset, Draft, Policy
from app.storage.fixtures import validate_dataset, validate_draft_shape
from app.storage.interfaces import DuplicateRecord, IdempotencyConflict, MissingRecord, OperationInProgress, RevisionConflict
from app.storage.records import AuditRecord, IdempotencyRecord, IdempotencyScope, OutboxRecord, ReviewRecord, message_hash


def utc_now():
    return datetime.now(timezone.utc)


def stamp(value):
    if value.tzinfo is None:
        raise ValueError('Storage clock must be timezone-aware')
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


@dataclass
class State:
    contexts: Dict[str, Context]
    policy: Policy
    drafts: Dict[str, Draft] = field(default_factory=dict)
    reviews: Dict[str, ReviewRecord] = field(default_factory=dict)
    deliveries: Dict[str, OutboxRecord] = field(default_factory=dict)
    audit: Dict[str, AuditRecord] = field(default_factory=dict)
    idempotency: Dict[tuple, IdempotencyRecord] = field(default_factory=dict)


class Repository:
    def __init__(self, transaction):
        self.transaction = transaction

    @property
    def state(self):
        if self.transaction.closed:
            raise RuntimeError('Repository used outside its unit of work')
        return self.transaction.staged


class Contexts(Repository):
    def get(self, customer_id):
        try:
            return self.state.contexts[customer_id].model_copy(deep=True)
        except KeyError:
            raise MissingRecord('Customer context not found') from None

    def get_policy(self):
        return self.state.policy.model_copy(deep=True)


class Drafts(Repository):
    def get(self, draft_id):
        try:
            return self.state.drafts[draft_id].model_copy(deep=True)
        except KeyError:
            raise MissingRecord('Draft not found') from None

    def add(self, draft):
        draft = Draft.model_validate(draft.model_dump())
        validate_draft_shape(draft)
        if draft.draft_id in self.state.drafts:
            raise DuplicateRecord('Draft already exists')
        if draft.customer_id not in self.state.contexts:
            raise MissingRecord('Customer context not found')
        if draft.revision != 1 or draft.status not in ('ready_for_review', 'blocked'):
            raise RevisionConflict('New drafts must be unapproved revision 1')
        self.state.drafts[draft.draft_id] = draft.model_copy(deep=True)

    def replace(self, draft, expected_revision):
        current = self.get(draft.draft_id)
        draft = Draft.model_validate(draft.model_dump())
        validate_draft_shape(draft)
        if current.revision != expected_revision or draft.revision != expected_revision + 1:
            raise RevisionConflict('Draft revision changed')
        if draft.customer_id != current.customer_id or draft.created_at != current.created_at:
            raise RevisionConflict('Draft identity is immutable')
        allowed = {'ready_for_review': {'ready_for_review', 'approved', 'rejected', 'mock_sent'}, 'blocked': {'ready_for_review', 'rejected'}}
        if draft.status not in allowed.get(current.status, set()):
            raise RevisionConflict('Draft transition is not permitted')
        self.state.drafts[draft.draft_id] = draft.model_copy(deep=True)


class Reviews(Repository):
    def add(self, record):
        record = ReviewRecord.model_validate(record.model_dump())
        draft = self.transaction.drafts.get(record.draft_id)
        if record.review_id in self.state.reviews:
            raise DuplicateRecord('Review already exists')
        if record.revision != draft.revision or record.request.expected_revision != draft.revision - 1:
            raise RevisionConflict('Review must refer to the committed draft revision')
        if any(r.draft_id == record.draft_id and r.revision == record.revision for r in self.state.reviews.values()):
            raise DuplicateRecord('Draft revision already reviewed')
        self.state.reviews[record.review_id] = record.model_copy(deep=True)

    def for_draft(self, draft_id):
        return [r.model_copy(deep=True) for r in self.state.reviews.values() if r.draft_id == draft_id]


class Deliveries(Repository):
    def add(self, record):
        record = OutboxRecord.model_validate(record.model_dump())
        if record.delivery_id in self.state.deliveries or any(r.draft_id == record.draft_id for r in self.state.deliveries.values()):
            raise DuplicateRecord('Draft already has a mock outbox entry')
        draft = self.transaction.drafts.get(record.draft_id)
        if (draft.status != 'mock_sent' or draft.delivery_id != record.delivery_id or draft.customer_id != record.customer_id or draft.campaign_key != record.campaign_key or draft.message is None or message_hash(draft.message) != record.content_hash):
            raise RevisionConflict('Outbox must match an approved mock-delivery draft')
        if any(c.contact_id == record.delivery_id for ctx in self.state.contexts.values() for c in ctx.contacts):
            raise DuplicateRecord('Contact ID already exists')
        context = self.state.contexts[record.customer_id]
        if len(context.contacts) >= 100:
            raise RevisionConflict('Context contact capacity exceeded')
        # Store the ledger entry and its contact together in the same staged state.
        contact = Contact(contact_id=record.delivery_id, customer_id=record.customer_id, campaign_key=record.campaign_key, channel='email', sent_at=record.sent_at, delivery='mock_email')
        context.contacts.append(contact)
        self.state.deliveries[record.delivery_id] = record.model_copy(deep=True)

    def for_customer(self, customer_id):
        return [r.model_copy(deep=True) for r in self.state.deliveries.values() if r.customer_id == customer_id]


class Audit(Repository):
    def add(self, record):
        record = AuditRecord.model_validate(record.model_dump())
        if record.audit_id in self.state.audit:
            raise DuplicateRecord('Audit event already exists')
        current = self.transaction.drafts.get(record.draft.draft_id)
        if current.model_dump() != record.draft.model_dump():
            raise RevisionConflict('Audit snapshot must match the current draft')
        self.state.audit[record.audit_id] = record.model_copy(deep=True)

    def for_draft(self, draft_id):
        return [r.model_copy(deep=True) for r in self.state.audit.values() if r.draft.draft_id == draft_id]


class Idempotency(Repository):
    def _current(self, scope):
        record = self.state.idempotency.get(scope.storage_key())
        if record and datetime.fromisoformat(record.expires_at.replace('Z', '+00:00')) <= self.transaction.store.clock():
            del self.state.idempotency[scope.storage_key()]
            return None
        return record

    def reserve(self, scope, request_hash):
        scope = IdempotencyScope.model_validate(scope.model_dump())
        record = self._current(scope)
        if record:
            if record.request_hash != request_hash:
                raise IdempotencyConflict('Key used for another request body')
            if record.state == 'pending':
                raise OperationInProgress('Matching request is still in progress')
            return record.model_copy(deep=True)
        record = IdempotencyRecord(scope=scope, request_hash=request_hash, state='pending', http_status=None, response_body=None, expires_at=stamp(self.transaction.store.clock() + timedelta(hours=24)))
        self.state.idempotency[scope.storage_key()] = record.model_copy(deep=True)
        return record

    def complete(self, scope, request_hash, http_status, response_body):
        record = self._current(scope)
        if record is None:
            raise MissingRecord('Idempotency reservation not found')
        if record.request_hash != request_hash:
            raise IdempotencyConflict('Request hash changed')
        if record.state != 'pending' or not 200 <= http_status < 300:
            raise RevisionConflict('Only a pending successful result can be completed')
        # Round-trip ensures responses are JSON, not runtime objects or NaN values.
        import json
        body = json.loads(json.dumps(response_body, allow_nan=False))
        self.state.idempotency[scope.storage_key()] = IdempotencyRecord(scope=scope, request_hash=request_hash, state='completed', http_status=http_status, response_body=body, expires_at=stamp(self.transaction.store.clock() + timedelta(hours=24)))

    def release(self, scope, request_hash):
        record = self._current(scope)
        if record is None:
            return
        if record.request_hash != request_hash:
            raise IdempotencyConflict('Request hash changed')
        if record.state != 'pending':
            raise RevisionConflict('Completed results cannot be released')
        del self.state.idempotency[scope.storage_key()]


class MemoryUnitOfWork:
    def __init__(self, store):
        self.store = store
        self.closed = True
        self.committed = False
        self.entered = False

    def __enter__(self):
        if self.entered:
            raise RuntimeError('Unit of work cannot be reused')
        self.store.lock.acquire()
        if self.store.active:
            self.store.lock.release()
            raise RuntimeError('Nested units of work are not supported')
        try:
            self.staged = deepcopy(self.store.state)
            self.store.active = True
            self.entered = True
            self.closed = False
            self.contexts = Contexts(self)
            self.drafts = Drafts(self)
            self.reviews = Reviews(self)
            self.deliveries = Deliveries(self)
            self.audit = Audit(self)
            self.idempotency = Idempotency(self)
            return self
        except Exception:
            self.store.lock.release()
            raise

    def commit(self):
        if self.closed:
            raise RuntimeError('Unit of work is closed')
        self.committed = True

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            if exc_type is None and self.committed:
                self.store.state = self.staged
        finally:
            self.closed = True
            self.store.active = False
            self.store.lock.release()
        return False


class MemoryStorage:
    def __init__(self, dataset: Dataset, drafts: Optional[List[Draft]] = None, clock: Callable = utc_now):
        validate_dataset(dataset)
        self.lock = RLock()
        self.active = False
        self.clock = clock
        self.state = State(contexts={ctx.customer.customer_id: ctx.model_copy(deep=True) for ctx in dataset.customers}, policy=dataset.policy.model_copy(deep=True))
        # Evaluation labels deliberately do not enter runtime storage.
        with self.unit_of_work() as uow:
            for draft in drafts or []:
                uow.drafts.add(draft)
            uow.commit()

    def unit_of_work(self):
        return MemoryUnitOfWork(self)
