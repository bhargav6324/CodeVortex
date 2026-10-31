from pathlib import Path as FilePath
from typing import Annotated, Callable, Optional

from fastapi import Depends, FastAPI, Path, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.auth import DelegationClaims, authorize_customer, require_idempotency, require_reviewer, require_tool_identity
from app.config import ROOT, Reviewer, Settings, load_settings
from app.dependencies import get_storage
from app.errors import ApiError, register_error_handlers
from app.middleware import ID_PATTERN, RequestBoundary
from app.models import Context, Draft, DraftRequest, Error, Health, ReviewRequest, ToolRequest, ToolResponse
from app.storage.fixtures import load_fixtures
from app.storage.interfaces import Storage
from app.storage.memory import MemoryStorage
from app.storage.sqlite import SQLiteStorage
from app.clock import utc_now
from app.services.policy import PolicyEngine
from app.services.tools import ToolService
from app.services.ai_client import AIClient, HTTPAIClient
from app.services.generation import GenerationService
from app.services.review import ReviewService

ResourceID = Annotated[str, Path(pattern=ID_PATTERN)]
ERROR_RESPONSES = {code: {"model": Error} for code in (401, 403, 404, 409, 422, 429, 500, 503, 504)}


def unavailable(message):
    raise ApiError(503, "SERVICE_UNAVAILABLE", message, retryable=True)


def create_app(settings: Settings = None, storage: Optional[Storage] = None, ai_client: Optional[AIClient] = None, clock: Callable = utc_now) -> FastAPI:
    app = FastAPI(title="CodeVortex Backend", version="1.0.0", redirect_slashes=False)
    app.state.settings = settings if settings is not None else load_settings()
    if storage is None:
        config = app.state.settings
        def fixture_path(value):
            path = FilePath(value)
            return path if path.is_absolute() else ROOT / path
        if config.storage_backend == "sqlite":
            storage = SQLiteStorage(fixture_path(config.database_path), clock=clock)
            if not storage.seeded():
                dataset, drafts = load_fixtures(fixture_path(config.dataset_path), fixture_path(config.draft_fixture_path) if config.draft_fixture_path else None)
                storage.seed(dataset, drafts)
        else:
            dataset, drafts = load_fixtures(fixture_path(config.dataset_path), fixture_path(config.draft_fixture_path) if config.draft_fixture_path else None)
            storage = MemoryStorage(dataset, drafts, clock=clock)
    app.state.storage = storage
    engine = PolicyEngine()
    ai_adapter = ai_client if ai_client is not None else HTTPAIClient(app.state.settings)
    register_error_handlers(app)
    app.add_middleware(CORSMiddleware,
                       allow_origins=app.state.settings.cors_origins,
                       allow_credentials=False,
                       allow_methods=["GET", "POST", "OPTIONS"],
                       allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
                       expose_headers=["X-Request-ID", "X-Contract-Version", "Retry-After"])
    app.add_middleware(RequestBoundary, origins=app.state.settings.cors_origins)

    @app.get("/health", response_model=Health)
    async def health():
        return Health(status="ok", service="backend", contract_version="1.0.0")

    @app.get("/api/v1/customers/{customer_id}/context", response_model=Context, responses=ERROR_RESPONSES)
    def customer_context(customer_id: ResourceID, reviewer: Reviewer = Depends(require_reviewer), storage: Storage = Depends(get_storage)):
        authorize_customer(reviewer, customer_id)
        with storage.unit_of_work() as uow:
            return uow.contexts.get(customer_id)

    @app.post("/api/v1/drafts", response_model=Draft, status_code=201, responses={**ERROR_RESPONSES, 200: {"model": Draft}})
    async def create_draft(body: DraftRequest, request: Request, response: Response, reviewer: Reviewer = Depends(require_reviewer), key: str = Depends(require_idempotency), storage: Storage = Depends(get_storage)):
        authorize_customer(reviewer, body.customer_id)
        service = GenerationService(storage, engine, ai_adapter, app.state.settings, clock)
        draft, status = await service.create(body, reviewer, key, request.state.request_id)
        response.status_code = status
        return draft

    @app.get("/api/v1/drafts/{draft_id}", response_model=Draft, responses=ERROR_RESPONSES)
    def get_draft(draft_id: ResourceID, reviewer: Reviewer = Depends(require_reviewer), storage: Storage = Depends(get_storage)):
        with storage.unit_of_work() as uow:
            draft = uow.drafts.get(draft_id)
        authorize_customer(reviewer, draft.customer_id)
        return draft

    @app.post("/api/v1/drafts/{draft_id}/review", response_model=Draft, responses=ERROR_RESPONSES)
    def review_draft(draft_id: ResourceID, body: ReviewRequest, request: Request, reviewer: Reviewer = Depends(require_reviewer), key: str = Depends(require_idempotency), storage: Storage = Depends(get_storage)):
        if app.state.settings.storage_backend != "sqlite":
            # Keep the current memory-only testing deployment read-only for review.
            with storage.unit_of_work() as uow:
                draft = uow.drafts.get(draft_id)
            authorize_customer(reviewer, draft.customer_id)
            unavailable("Draft review requires the persistent SQLite backend.")
        return ReviewService(storage, engine, clock).review(draft_id, body, reviewer, key, request.state.request_id)

    @app.post("/internal/v1/tools/execute", response_model=ToolResponse, responses=ERROR_RESPONSES)
    def execute_tool(body: ToolRequest, delegation: DelegationClaims = Depends(require_tool_identity), storage: Storage = Depends(get_storage)):
        tool = body.root
        if tool.turn_id != delegation.turn_id or tool.arguments.customer_id != delegation.customer_id:
            raise ApiError(403, "FORBIDDEN", "Tool request is outside its delegation scope.")
        return ToolService(storage, engine, clock).execute(body, delegation)

    return app
