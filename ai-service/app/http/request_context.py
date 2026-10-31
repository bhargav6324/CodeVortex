"""Request ID and contract headers on every response, including errors."""

from __future__ import annotations

import logging
import re
import uuid
from contextvars import ContextVar

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.contract.models import CONTRACT_VERSION, ID_PATTERN

log = logging.getLogger(__name__)
_ID_RE = re.compile(ID_PATTERN)
_request_id: ContextVar[str] = ContextVar("request_id", default="unknown")


def current_request_id() -> str:
    return _request_id.get()


def new_request_id() -> str:
    return "REQ_" + uuid.uuid4().hex


class RequestContextMiddleware:
    """Pure ASGI middleware so the headers also land on handler-produced error responses.

    A malformed X-Request-ID is answered with 422 INVALID_REQUEST under a fresh ID.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        supplied = None
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                supplied = value.decode("latin-1")
                break

        bad_header = supplied is not None and not _ID_RE.fullmatch(supplied)
        request_id = supplied if supplied is not None and not bad_header else new_request_id()
        token = _request_id.set(request_id)

        started = False

        async def send_with_headers(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() not in _OWNED]
                headers += [
                    (b"x-request-id", request_id.encode()),
                    (b"x-contract-version", CONTRACT_VERSION.encode()),
                    (b"cache-control", b"no-store"),
                ]
                message = {**message, "headers": headers}
            await send(message)

        # Imported here to avoid a cycle: errors.py reads current_request_id from this module.
        from app.contract.models import ErrorDetail
        from app.http.errors import ApiError, error_response

        try:
            if bad_header:
                err = ApiError(
                    "INVALID_REQUEST",
                    "X-Request-ID has an invalid format.",
                    details=[ErrorDetail(field="X-Request-ID", reason="must match ^[A-Za-z0-9_-]{1,64}$")],
                )
                await error_response(err, request_id)(scope, receive, send_with_headers)
            else:
                await self.app(scope, receive, send_with_headers)
        except Exception:
            # Unhandled errors would otherwise reach Starlette's outer 500 page without our headers.
            log.exception("unhandled error", extra={"request_id": request_id})
            if started:
                raise
            err = ApiError("INTERNAL_ERROR", "Unexpected error.")
            await error_response(err, request_id)(scope, receive, send_with_headers)
        finally:
            _request_id.reset(token)


_OWNED = {b"x-request-id", b"x-contract-version", b"cache-control"}
