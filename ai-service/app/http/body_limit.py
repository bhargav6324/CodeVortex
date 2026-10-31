"""Reject request bodies over the internal limit (256 KiB) with 422 INVALID_REQUEST."""

from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.contract.models import ErrorDetail
from app.http.errors import ApiError, error_response
from app.http.request_context import current_request_id


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        for name, value in scope.get("headers", []):
            if name == b"content-length" and value.isdigit() and int(value) > self.max_bytes:
                await self._reject(scope, receive, send)
                return

        # Buffer the body so chunked uploads without Content-Length are limited too.
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_bytes:
                await self._reject(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        body = b"".join(chunks)
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        err = ApiError(
            "INVALID_REQUEST",
            "Request body is too large.",
            details=[ErrorDetail(field=None, reason=f"body exceeds {self.max_bytes} bytes")],
        )
        await error_response(err, current_request_id())(scope, receive, send)
