import logging
import re
import uuid

from starlette.datastructures import Headers, MutableHeaders

from app.errors import ApiError, error_response

ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
ALLOWED_HEADERS = {"authorization", "content-type", "idempotency-key", "x-request-id"}
logger = logging.getLogger("codevortex")


class RequestBoundary:
    """Bound requests and normalize errors without logging request bodies/tokens."""

    def __init__(self, app, origins):
        self.app = app
        self.origins = set(origins)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        incoming_id = headers.get("x-request-id")
        request_id = incoming_id if incoming_id and re.fullmatch(ID_PATTERN, incoming_id) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        started = False

        async def send_with_headers(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                out = MutableHeaders(scope=message)
                out["X-Request-ID"] = request_id
                out["X-Contract-Version"] = "1.0.0"
                out["Cache-Control"] = "no-store"
                origin = headers.get("origin")
                if origin in self.origins:
                    out["Access-Control-Allow-Origin"] = origin
                    out["Access-Control-Expose-Headers"] = "X-Request-ID, X-Contract-Version, Retry-After"
                    out.add_vary_header("Origin")
            await send(message)

        try:
            if incoming_id is not None and not re.fullmatch(ID_PATTERN, incoming_id):
                raise ApiError(422, "INVALID_REQUEST", "X-Request-ID has an invalid format.")
            origin = headers.get("origin")
            if origin and origin not in self.origins:
                raise ApiError(403, "FORBIDDEN", "Origin is not allowed.")
            if scope["method"] == "OPTIONS" and headers.get("access-control-request-method"):
                method = headers["access-control-request-method"]
                requested = {v.strip().lower() for v in headers.get("access-control-request-headers", "").split(",") if v.strip()}
                if method not in {"GET", "POST", "OPTIONS"} or not requested <= ALLOWED_HEADERS:
                    raise ApiError(403, "FORBIDDEN", "CORS request is not allowed.")
            api_path = scope["path"] == "/health" or scope["path"].startswith(("/api/", "/internal/"))
            if api_path and scope["query_string"]:
                raise ApiError(422, "INVALID_REQUEST", "Query parameters are not supported.")
            if scope["method"] == "POST":
                if headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
                    raise ApiError(422, "INVALID_REQUEST", "Content-Type must be application/json.")
                limit = 256 * 1024 if scope["path"].startswith("/internal/") else 64 * 1024
                chunks = []
                size = 0
                while True:
                    event = await receive()
                    if event["type"] == "http.disconnect":
                        return
                    chunk = event.get("body", b"")
                    size += len(chunk)
                    if size > limit:
                        raise ApiError(422, "INVALID_REQUEST", "Request body exceeds the allowed size.")
                    chunks.append(chunk)
                    if not event.get("more_body", False):
                        break
                try:
                    b"".join(chunks).decode("utf-8")
                except UnicodeDecodeError:
                    raise ApiError(422, "INVALID_REQUEST", "JSON must use UTF-8 encoding.") from None
                consumed = False

                async def buffered_receive():
                    nonlocal consumed
                    if not consumed:
                        consumed = True
                        return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
                    return await receive()

                await self.app(scope, buffered_receive, send_with_headers)
            else:
                await self.app(scope, receive, send_with_headers)
        except Exception as exc:
            if started:
                raise
            if isinstance(exc, ApiError):
                error = exc
            else:
                # Log only an exception type and correlation ID, never exception inputs.
                logger.error("request_failed request_id=%s exception_type=%s", request_id, type(exc).__name__)
                error = ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred.")
            await error_response(error, request_id)(scope, receive, send_with_headers)
