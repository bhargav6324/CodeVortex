"""The sole backend tool gateway; data remains authoritative on the backend."""
from app.errors import ApiError
from app.models import EvaluateToolResponse, ToolResponse, ValidateToolResponse
from app.storage.interfaces import MissingRecord
from app.storage.records import message_hash


class ToolService:
    def __init__(self, storage, engine, clock):
        self.storage = storage
        self.engine = engine
        self.clock = clock

    def execute(self, body, claims):
        tool = body.root
        if tool.turn_id != claims.turn_id or tool.arguments.customer_id != claims.customer_id:
            raise ApiError(403, 'FORBIDDEN', 'Tool request is outside its delegation scope.')
        with self.storage.unit_of_work() as uow:
            try:
                turn = uow.turns.get(tool.turn_id)
            except MissingRecord:
                raise ApiError(403, 'FORBIDDEN', 'No active backend-owned turn is available.') from None
            request = turn.request
            context, policy = request.context, request.policy
            versions_match = (context.data_version == claims.data_version and policy.policy_version == claims.policy_version and policy.template_version == claims.template_version)
            if request.customer_id != claims.customer_id or not versions_match:
                raise ApiError(403, 'FORBIDDEN', 'Delegation does not match the stored customer snapshot.')
            if int(self.clock().timestamp()) >= claims.expires_at:
                raise ApiError(403, 'FORBIDDEN', 'Delegation has expired.')
            if tool.tool == 'evaluate_customer':
                if turn.evaluated:
                    raise ApiError(409, 'INVALID_TRANSITION', 'Customer evaluation has already been consumed for this turn.')
                turn.evaluated = True
                result = ToolResponse(root=EvaluateToolResponse(tool='evaluate_customer', turn_id=tool.turn_id, result=turn.plan))
            else:
                if not turn.evaluated or turn.validated or not turn.plan.validation.passed:
                    raise ApiError(409, 'INVALID_TRANSITION', 'Draft validation requires one successful evaluation and may run once.')
                args = tool.arguments
                # Snapshot policy decisions use the captured reference clock; final persistence
                # performs another validation against the actual current server clock.
                from app.storage.fixtures import instant
                checks = self.engine.validate_message(context, policy, instant(request.as_of), args.message, args.selected_offer_id, args.template_id, uow.deliveries.for_customer(claims.customer_id))
                turn.validated = True
                turn.candidate_hash = message_hash(args.message)
                turn.candidate_validation = checks
                result = ToolResponse(root=ValidateToolResponse(tool='validate_draft', turn_id=tool.turn_id, result=checks))
            uow.turns.replace(turn)
            uow.commit()
            return result
