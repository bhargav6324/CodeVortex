"""Human review and local mock delivery inside one storage transaction."""
from app.auth import authorize_customer
from app.clock import stamp
from app.errors import ApiError
from app.models import Draft
from app.services.generation import new_id
from app.storage.records import AuditRecord, IdempotencyScope, OutboxRecord, ReviewRecord, hash_json, message_hash


class ReviewService:
    def __init__(self, storage, engine, clock):
        self.storage, self.engine, self.clock = storage, engine, clock

    def review(self, draft_id, body, reviewer, key, request_id):
        scope = IdempotencyScope(actor_id=reviewer.actor_id, method='POST', path='/api/v1/drafts/' + draft_id + '/review', key=key)
        digest = hash_json(body.model_dump(mode='json'))
        with self.storage.unit_of_work() as uow:
            draft = uow.drafts.get(draft_id)
            authorize_customer(reviewer, draft.customer_id)
            record = uow.idempotency.reserve(scope, digest)
            if record.state == 'completed':
                return Draft.model_validate(record.response_body)
            if draft.status in ('approved', 'rejected', 'mock_sent'):
                raise ApiError(409, 'INVALID_TRANSITION', 'This draft is terminal; generate a new draft for another action.')
            if draft.revision != body.expected_revision:
                raise ApiError(409, 'VERSION_CONFLICT', 'The draft changed; reload and review the current revision.')
            now = self.clock()
            timestamp = stamp(now)
            if body.decision == 'reject':
                # Rejection must remain possible even with missing consent or invalid bills.
                draft.status = 'rejected'
                event = 'draft_rejected'
            else:
                if body.decision == 'approve' and draft.status == 'blocked':
                    raise ApiError(422, 'REVIEW_BLOCKED', 'A blocked draft cannot be approved. Correct it through a validated edit or regenerate.')
                context = uow.contexts.get(draft.customer_id)
                policy = uow.contexts.get_policy()
                if (draft.versions.data_version != context.data_version or draft.versions.policy_version != policy.policy_version or draft.versions.template_version != policy.template_version):
                    raise ApiError(409, 'VERSION_CONFLICT', 'Customer, policy or template version changed; regenerate the draft.')
                candidate = body.edited_message if body.decision == 'edit' else draft.message
                if candidate is None or draft.strategy is None:
                    raise ApiError(422, 'REVIEW_BLOCKED', 'No supported message/strategy is available for this action.')
                deliveries = uow.deliveries.for_customer(draft.customer_id)
                checks = self.engine.validate_message(context, policy, now, candidate, draft.selected_offer_id, draft.strategy.template_id, deliveries)
                if not checks.passed:
                    details = [{'field': item.field, 'reason': item.code + ': ' + item.message} for item in checks.findings if item.severity == 'block']
                    raise ApiError(422, 'REVIEW_BLOCKED', 'Current safety checks prevent this action; no changes were saved.', details=details)
                draft.validation = checks
                if body.decision == 'edit':
                    # Return the edited revision for inspection; never approve as part of edit.
                    plan = self.engine.evaluate(context, policy, now, deliveries)
                    _, slots = self.engine.render(context, policy, plan)
                    evidence = {item.field: item for segment in plan.segments for item in segment.evidence}
                    evidence.update({item.field: item for item in slots})
                    draft.message = candidate
                    draft.segments, draft.strategy = plan.segments, plan.strategy
                    draft.selected_offer_id, draft.campaign_key = plan.selected_offer_id, plan.campaign_key
                    draft.evidence = list(evidence.values())[:40]
                    draft.status, event = 'ready_for_review', 'draft_edited'
                else:
                    draft.approved_by, draft.approved_at = reviewer.actor_id, timestamp
                    if body.delivery == 'mock_email':
                        draft.status, draft.send_status = 'mock_sent', 'mock_sent'
                        draft.delivery_id = new_id('DELIVERY')
                    else:
                        draft.status, draft.send_status = 'approved', 'draft_only'
                    event = 'draft_approved'
            draft.revision += 1
            draft.updated_at, draft.feedback = timestamp, body.feedback
            uow.drafts.replace(draft, expected_revision=body.expected_revision)
            uow.reviews.add(ReviewRecord(review_id=new_id('REVIEW'), draft_id=draft.draft_id, revision=draft.revision, actor_id=reviewer.actor_id, request=body, reviewed_at=timestamp))
            if draft.status == 'mock_sent':
                # This adapter is a local ledger. It has no SMTP/network delivery call.
                uow.deliveries.add(OutboxRecord(delivery_id=draft.delivery_id, draft_id=draft.draft_id, customer_id=draft.customer_id, campaign_key=draft.campaign_key, content_hash=message_hash(draft.message), sent_at=timestamp, delivery='mock_email'))
            uow.audit.add(AuditRecord(audit_id=new_id('AUDIT'), event=event, actor_id=reviewer.actor_id, request_id=request_id, occurred_at=timestamp, draft=draft, review=body))
            if draft.status == 'mock_sent':
                uow.audit.add(AuditRecord(audit_id=new_id('AUDIT'), event='mock_sent', actor_id=reviewer.actor_id, request_id=request_id, occurred_at=timestamp, draft=draft, review=body))
            uow.idempotency.complete(scope, digest, 200, draft.model_dump(mode='json'))
            uow.commit()
            return draft
