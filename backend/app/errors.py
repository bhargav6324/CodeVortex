from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.models import Error
from app.storage.interfaces import DuplicateRecord, IdempotencyConflict, MissingRecord, OperationInProgress, RevisionConflict, StorageUnavailable


class ApiError(Exception):
    def __init__(self, status, code, message, *, retryable=False, details=None):
        self.status = status
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or []


def error_response(error: ApiError, request_id: str):
    body = Error.model_validate({"error": {
        "code": error.code, "message": error.message,
        "request_id": request_id, "retryable": error.retryable,
        "details": error.details[:20],
    }})
    headers = {"WWW-Authenticate": "Bearer"} if error.status == 401 else {}
    if error.code == "VERSION_CONFLICT" and error.retryable:
        headers["Retry-After"] = "1"
    return JSONResponse(status_code=error.status, content=body.model_dump(mode="json"), headers=headers)


def register_error_handlers(app):
    @app.exception_handler(StorageUnavailable)
    async def storage_unavailable(request: Request, exc: StorageUnavailable):
        return error_response(ApiError(503, "SERVICE_UNAVAILABLE", "Persistent storage is busy or unavailable.", retryable=True), request.state.request_id)

    @app.exception_handler(MissingRecord)
    async def missing_record(request: Request, exc: MissingRecord):
        return error_response(ApiError(404, "NOT_FOUND", "Resource not found."), request.state.request_id)

    async def storage_conflict(request: Request, exc):
        pending = isinstance(exc, OperationInProgress)
        code = "IDEMPOTENCY_CONFLICT" if isinstance(exc, IdempotencyConflict) else "VERSION_CONFLICT"
        return error_response(ApiError(409, code, "Operation conflicts with the current stored state.", retryable=pending), request.state.request_id)

    for exception_type in (DuplicateRecord, RevisionConflict, IdempotencyConflict, OperationInProgress):
        app.add_exception_handler(exception_type, storage_conflict)

    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError):
        return error_response(exc, request.state.request_id)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        details = [{"field": ".".join(str(x) for x in e["loc"])[:200],
                    "reason": "Invalid or missing value (" + e["type"] + ")."}
                   for e in exc.errors()[:20]]
        # Never echo Pydantic's input/context or invalid customer values.
        return error_response(ApiError(422, "INVALID_REQUEST", "Request does not match the contract.", details=details), request.state.request_id)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        if exc.status_code == 404:
            error = ApiError(404, "NOT_FOUND", "Resource not found.")
        elif exc.status_code == 400:
            error = ApiError(422, "INVALID_REQUEST", "Malformed request body.")
        elif exc.status_code == 405:
            error = ApiError(422, "INVALID_REQUEST", "Method is not supported for this path.")
        else:
            error = ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred.")
        return error_response(error, request.state.request_id)
