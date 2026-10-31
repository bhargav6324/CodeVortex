"""Contract `Error` envelope for every non-success response, including FastAPI's own 422/404."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.contract.models import Error, ErrorBody, ErrorCode, ErrorDetail
from app.http.request_context import current_request_id

_STATUS: dict[str, int] = {
    "UNAUTHORIZED": 401,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "IDEMPOTENCY_CONFLICT": 409,
    "VERSION_CONFLICT": 409,
    "INVALID_TRANSITION": 409,
    "INVALID_REQUEST": 422,
    "REVIEW_BLOCKED": 422,
    "RATE_LIMITED": 429,
    "INTERNAL_ERROR": 500,
    "SERVICE_UNAVAILABLE": 503,
    "AI_TIMEOUT": 504,
}

_MAX_DETAILS = 20


class ApiError(Exception):
    """Raise anywhere in a request to return a contract Error."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        retryable: bool = False,
        details: list[ErrorDetail] | None = None,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or []
        self.retry_after = retry_after

    @property
    def status_code(self) -> int:
        return _STATUS[self.code]


def error_response(err: ApiError, request_id: str) -> JSONResponse:
    body = Error(
        error=ErrorBody(
            code=err.code,
            message=err.message[:500],
            request_id=request_id,
            retryable=err.retryable,
            details=err.details[:_MAX_DETAILS],
        )
    )
    headers = {"Retry-After": str(err.retry_after)} if err.retry_after is not None else None
    return JSONResponse(body.model_dump(mode="json"), status_code=err.status_code, headers=headers)


def _validation_details(exc: RequestValidationError) -> list[ErrorDetail]:
    details = []
    for e in exc.errors()[:_MAX_DETAILS]:
        loc = [str(p) for p in e.get("loc", ()) if p != "body"]
        details.append(ErrorDetail(field=".".join(loc)[:200] or None, reason=str(e.get("msg", "invalid"))[:500] or "invalid"))
    return details


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc, current_request_id())

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        err = ApiError("INVALID_REQUEST", "Request does not match the contract schema.", details=_validation_details(exc))
        return error_response(err, current_request_id())

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Unknown routes and methods: the contract has no 405, so expose neither.
        if exc.status_code in (404, 405):
            err = ApiError("NOT_FOUND", "Not found.")
        elif exc.status_code == 400:
            err = ApiError("INVALID_REQUEST", "Malformed request.")
        else:
            err = ApiError("INTERNAL_ERROR", "Unexpected error.")
        return error_response(err, current_request_id())
    # Unhandled exceptions are turned into INTERNAL_ERROR by RequestContextMiddleware.
