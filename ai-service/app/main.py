"""AI service entry point: `uvicorn app.main:app --host 0.0.0.0 --port 8001`."""

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from app.api.generate import router as generate_router
from app.contract.models import CONTRACT_VERSION
from app.http.body_limit import BodyLimitMiddleware
from app.http.errors import install_error_handlers
from app.http.request_context import RequestContextMiddleware

MAX_INTERNAL_BODY_BYTES = 256 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One pooled client for backend tool calls; per-call timeouts are set by HttpToolClient.
    async with httpx.AsyncClient(follow_redirects=False) as http:
        app.state.http = http
        yield


def create_app() -> FastAPI:
    app = FastAPI(title="CodeVortex AI service", version=CONTRACT_VERSION, lifespan=lifespan)
    install_error_handlers(app)
    app.include_router(generate_router)
    # Last added runs first: request context wraps everything, so limit errors get the headers too.
    app.add_middleware(BodyLimitMiddleware, max_bytes=MAX_INTERNAL_BODY_BYTES)
    app.add_middleware(RequestContextMiddleware)
    return app


app = create_app()
