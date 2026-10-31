"""Open scoped AI turns through the existing draft endpoint; never approve or send."""
import asyncio
from datetime import datetime, timezone
from uuid import uuid4

from app.auth import DelegationClaims, issue_delegation
from app.clock import stamp
from app.errors import ApiError
from app.models import AIRequest, AIResponse, Draft, Versions
from app.storage.interfaces import MissingRecord
from app.storage.records import AuditRecord, IdempotencyScope, TurnSnapshot, hash_json, message_hash
from app.services.policy import validation


def new_id(prefix):
    return prefix + '_' + uuid4().hex


class GenerationService:
    def __init__(self, storage, engine, ai_client, settings, clock):
        self.storage, self.engine = storage, engine
        self.ai_client, self.settings, self.clock = ai_client, settings, clock

    async def create(self, body, reviewer, key, request_id):
        scope = IdempotencyScope(actor_id=reviewer.actor_id, method='POST', path='/api/v1/drafts', key=key)
        digest = hash_json(body.model_dump(mode='json'))
        with self.storage.unit_of_work() as uow:
            result = uow.idempotency.reserve(scope, digest)
            if result.state == 'completed':
                return Draft.model_validate(result.response_body), 200
            uow.commit()
        turn_id = None
        committed = False
        try:
            now = self.clock()
            with self.storage.unit_of_work() as uow:
                context = uow.contexts.get(body.customer_id)
                policy = uow.contexts.get_policy()
                deliveries = uow.deliveries.for_customer(body.customer_id)
            context.as_of = stamp(now)
            plan = self.engine.evaluate(context, policy, now, deliveries)
            if not plan.validation.passed:
                draft = self.make_draft(context, policy, plan, None, self.evidence(plan), 'backend_policy_v1', 'not_invoked', request_id)
                self.persist(draft, scope, digest, reviewer, request_id, None)
                committed = True
                return draft, 201
            turn_id = new_id('TURN')
            issued = int(now.timestamp())
            claims = DelegationClaims(customer_id=body.customer_id, turn_id=turn_id, data_version=context.data_version, policy_version=policy.policy_version, template_version=policy.template_version, audience='codevortex-ai-turn', issued_at=issued, expires_at=issued + 60)
            payload = AIRequest(turn_id=turn_id, customer_id=body.customer_id, as_of=context.as_of, context=context, policy=policy, locale=body.locale)
            snapshot = TurnSnapshot(request=payload, plan=plan, expires_at=stamp(datetime.fromtimestamp(claims.expires_at, timezone.utc)))
            with self.storage.unit_of_work() as uow:
                uow.turns.add(snapshot)
                uow.commit()
            token = issue_delegation(self.settings, claims)
            try:
                response = await asyncio.wait_for(self.ai_client.generate(payload.model_copy(deep=True), token, request_id), timeout=25)
            except asyncio.TimeoutError:
                raise ApiError(504, 'AI_TIMEOUT', 'AI generation exceeded its time budget.', retryable=True) from None
            if not isinstance(response, AIResponse):
                raise ApiError(503, 'SERVICE_UNAVAILABLE', 'AI response does not match the frozen contract.', retryable=True)
            if response.generation_status == 'unavailable':
                raise ApiError(503, 'SERVICE_UNAVAILABLE', 'AI generation is unavailable.', retryable=True)
            with self.storage.unit_of_work() as uow:
                try:
                    active = uow.turns.get(turn_id)
                except MissingRecord:
                    raise ApiError(504, 'AI_TIMEOUT', 'AI turn has expired.', retryable=True) from None
                current_context = uow.contexts.get(body.customer_id)
                current_policy = uow.contexts.get_policy()
                if current_context.model_dump(exclude={'as_of'}) != context.model_dump(exclude={'as_of'}) or current_policy.model_dump() != policy.model_dump():
                    raise ApiError(409, 'VERSION_CONFLICT', 'Customer or policy data changed during generation; regenerate.')
                self.check_response(response, active)
                final_now = self.clock()
                checks = self.engine.validate_message(current_context, current_policy, final_now, response.message, plan.selected_offer_id, plan.strategy.template_id, uow.deliveries.for_customer(body.customer_id))
                plan.validation = validation(list(checks.findings) + list(active.candidate_validation.findings), final_now)
                _, factual_evidence = self.engine.render(context, policy, plan)
                evidence = self.evidence(plan, factual_evidence + response.evidence)
                candidate = None if any(item.code == 'SENSITIVE_DATA' for item in plan.validation.findings) else response.message
                draft = self.make_draft(context, policy, plan, candidate, evidence, response.prompt_version, response.model_version, request_id)
                self.stage_persist(uow, draft, scope, digest, reviewer, request_id, turn_id)
                uow.commit()
            committed = True
            return draft, 201
        finally:
            if not committed:
                # Cancellation/dependency failure cannot leave an endlessly pending key.
                # Never release a successful stored result or delete another turn.
                with self.storage.unit_of_work() as uow:
                    if turn_id is not None:
                        uow.turns.delete(turn_id)
                    uow.idempotency.release(scope, digest)
                    uow.commit()

    def check_response(self, response, active):
        def invalid():
            raise ApiError(503, 'SERVICE_UNAVAILABLE', 'AI result failed the backend response checks.', retryable=True)
        if response.turn_id != active.request.turn_id or response.message is None:
            invalid()
        if not active.evaluated or not active.validated or active.candidate_validation is None:
            invalid()
        if active.candidate_hash != message_hash(response.message):
            invalid()
        if response.plan.model_dump(exclude={'validation'}) != active.plan.model_dump(exclude={'validation'}):
            invalid()
        if response.plan.validation.model_dump() != active.candidate_validation.model_dump():
            invalid()
        expected = 'generated' if active.candidate_validation.passed else 'blocked'
        if response.generation_status != expected or response.model_version == 'not_invoked':
            invalid()
        facts = self.engine.allowed_evidence(active.request.context, active.request.policy)
        for evidence in response.evidence:
            if evidence.field not in facts:
                invalid()
            value = facts[evidence.field]
            if isinstance(value, bool) != isinstance(evidence.value, bool) or evidence.value != value:
                invalid()

    def evidence(self, plan, extra=()):
        items = [row for segment in plan.segments for row in segment.evidence] + list(extra)
        deduped = {}
        for row in items:
            deduped[row.field] = row
        return list(deduped.values())[:40]

    def make_draft(self, context, policy, plan, message, evidence, prompt_version, model_version, request_id):
        now = stamp(self.clock())
        return Draft(draft_id=new_id('DRAFT'), customer_id=context.customer.customer_id, revision=1,
                     status='ready_for_review' if plan.validation.passed else 'blocked', segments=plan.segments,
                     strategy=plan.strategy, selected_offer_id=plan.selected_offer_id, message=message,
                     evidence=evidence, validation=plan.validation,
                     versions=Versions(policy_version=policy.policy_version, template_version=policy.template_version, prompt_version=prompt_version, model_version=model_version, data_version=context.data_version),
                     campaign_key=plan.campaign_key, created_at=now, updated_at=now, approved_by=None, approved_at=None,
                     send_status='not_sent', delivery_id=None, feedback=None, request_id=request_id)

    def stage_persist(self, uow, draft, scope, digest, reviewer, request_id, turn_id):
        uow.drafts.add(draft)
        uow.audit.add(AuditRecord(audit_id=new_id('AUDIT'), event='draft_created', actor_id=reviewer.actor_id, request_id=request_id, occurred_at=draft.created_at, draft=draft, review=None))
        uow.idempotency.complete(scope, digest, 201, draft.model_dump(mode='json'))
        if turn_id is not None:
            uow.turns.delete(turn_id)

    def persist(self, draft, scope, digest, reviewer, request_id, turn_id):
        with self.storage.unit_of_work() as uow:
            self.stage_persist(uow, draft, scope, digest, reviewer, request_id, turn_id)
            uow.commit()
