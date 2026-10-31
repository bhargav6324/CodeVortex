"""Backend-owned storage contracts; adapters must not implement policy decisions."""
from typing import ContextManager, List, Protocol

from app.models import Context, Draft, Policy
from app.storage.records import AuditRecord, IdempotencyRecord, IdempotencyScope, OutboxRecord, ReviewRecord


class MissingRecord(Exception):
    pass


class DuplicateRecord(Exception):
    pass


class RevisionConflict(Exception):
    pass


class IdempotencyConflict(Exception):
    pass


class OperationInProgress(Exception):
    pass


class ContextRepository(Protocol):
    def get(self, customer_id: str) -> Context: ...
    def get_policy(self) -> Policy: ...


class DraftRepository(Protocol):
    def get(self, draft_id: str) -> Draft: ...
    def add(self, draft: Draft) -> None: ...
    def replace(self, draft: Draft, expected_revision: int) -> None: ...


class ReviewRepository(Protocol):
    def add(self, review: ReviewRecord) -> None: ...
    def for_draft(self, draft_id: str) -> List[ReviewRecord]: ...


class DeliveryRepository(Protocol):
    def add(self, delivery: OutboxRecord) -> None: ...
    def for_customer(self, customer_id: str) -> List[OutboxRecord]: ...


class AuditRepository(Protocol):
    def add(self, event: AuditRecord) -> None: ...
    def for_draft(self, draft_id: str) -> List[AuditRecord]: ...


class IdempotencyRepository(Protocol):
    def reserve(self, scope: IdempotencyScope, request_hash: str) -> IdempotencyRecord: ...
    def complete(self, scope: IdempotencyScope, request_hash: str, http_status: int, response_body: dict) -> None: ...
    def release(self, scope: IdempotencyScope, request_hash: str) -> None: ...


class UnitOfWork(Protocol):
    contexts: ContextRepository
    drafts: DraftRepository
    reviews: ReviewRepository
    deliveries: DeliveryRepository
    audit: AuditRepository
    idempotency: IdempotencyRepository

    def commit(self) -> None: ...


class Storage(Protocol):
    def unit_of_work(self) -> ContextManager[UnitOfWork]: ...
