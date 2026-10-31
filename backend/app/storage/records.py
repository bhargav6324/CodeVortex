"""Internal storage records, separate from the frozen public REST schemas."""
import hashlib
import json
from typing import Annotated, Literal, Optional

from pydantic import Field

from app.models import AIRequest, ContractModel, Draft, Message, Plan, ReviewRequest, UTCString, Validation

Identifier = Annotated[str, Field(pattern=r'^[A-Za-z0-9_-]{1,64}$')]
ContentHash = Annotated[str, Field(pattern=r'^[a-f0-9]{64}$')]


class ReviewRecord(ContractModel):
    review_id: Identifier
    draft_id: Identifier
    revision: Annotated[int, Field(ge=2)]
    actor_id: Identifier
    request: ReviewRequest
    reviewed_at: UTCString


class OutboxRecord(ContractModel):
    delivery_id: Identifier
    draft_id: Identifier
    customer_id: Identifier
    campaign_key: Identifier
    content_hash: ContentHash
    sent_at: UTCString
    delivery: Literal['mock_email']


class AuditRecord(ContractModel):
    audit_id: Identifier
    event: Literal['draft_created', 'draft_edited', 'draft_approved', 'draft_rejected', 'mock_sent']
    actor_id: Identifier
    request_id: Identifier
    occurred_at: UTCString
    draft: Draft
    review: Optional[ReviewRequest]


class IdempotencyScope(ContractModel):
    actor_id: Identifier
    method: Literal['POST']
    path: Annotated[str, Field(min_length=1, max_length=200)]
    key: Identifier

    def storage_key(self):
        return self.actor_id, self.method, self.path, self.key


class IdempotencyRecord(ContractModel):
    scope: IdempotencyScope
    request_hash: ContentHash
    state: Literal['pending', 'completed']
    http_status: Optional[int]
    response_body: Optional[dict]
    expires_at: UTCString


def hash_json(value: dict) -> str:
    """Stable hash independent of object-key order; inputs must be JSON data."""
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def message_hash(message: Message) -> str:
    return hash_json({key: value.replace('\r\n', '\n').strip() for key, value in message.model_dump().items()})


class TurnSnapshot(ContractModel):
    request: AIRequest
    plan: Plan
    expires_at: UTCString
    evaluated: bool = False
    validated: bool = False
    candidate_hash: Optional[ContentHash] = None
    candidate_validation: Optional[Validation] = None
