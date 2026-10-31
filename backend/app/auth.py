import base64
import hashlib
import hmac
import json
import re
import time
from datetime import datetime
from typing import Annotated, Literal, Optional

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import Field, ValidationError

from app.config import Reviewer
from app.errors import ApiError
from app.middleware import ID_PATTERN
from app.models import ContractModel

Identifier = Annotated[str, Field(pattern=ID_PATTERN)]
bearer_scheme = HTTPBearer(auto_error=False, description="Provisioned reviewer or internal-service credential; identities are not interchangeable.")


class DelegationClaims(ContractModel):
    customer_id: Identifier
    turn_id: Identifier
    data_version: Identifier
    policy_version: Identifier
    template_version: Identifier
    audience: Literal["codevortex-ai-turn"]
    issued_at: int
    expires_at: int


def bearer(request: Request) -> str:
    value = request.headers.get("authorization", "")
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token or " " in token:
        raise ApiError(401, "UNAUTHORIZED", "A valid bearer credential is required.")
    return token


def require_reviewer(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> Reviewer:
    token = bearer(request)
    for reviewer in request.app.state.settings.reviewers:
        if hmac.compare_digest(token.encode(), reviewer.token.get_secret_value().encode()):
            expiry = datetime.fromisoformat(reviewer.expires_at[:-1] + "+00:00").timestamp()
            if expiry <= time.time():
                break
            return reviewer
    raise ApiError(401, "UNAUTHORIZED", "A valid reviewer credential is required.")


def authorize_customer(reviewer: Reviewer, customer_id: str):
    # Conceal the existence of customers outside this reviewer's explicit allowlist.
    if customer_id not in reviewer.customer_ids:
        raise ApiError(404, "NOT_FOUND", "Resource not found.")


def require_idempotency(request: Request, header: Optional[str] = Header(None, alias="Idempotency-Key", description="Required on public POST requests; reuse only for identical retries.")) -> str:
    value = request.headers.get("idempotency-key", "")
    if not re.fullmatch(ID_PATTERN, value):
        raise ApiError(422, "INVALID_REQUEST", "A valid Idempotency-Key is required.")
    return value


def encode_part(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def issue_delegation(settings, claims: DelegationClaims) -> str:
    """Backend-only helper; there is deliberately no public token-issuance API."""
    payload = encode_part(claims.model_dump_json().encode())
    signature = hmac.new(settings.delegation_signing_secret.get_secret_value().encode(), payload.encode(), hashlib.sha256).digest()
    return payload + "." + encode_part(signature)


def require_tool_identity(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme), delegation_header: Optional[str] = Header(None, alias="X-Delegation-Token", description="Required signed backend-issued turn scope.")) -> DelegationClaims:
    settings = request.app.state.settings
    if not hmac.compare_digest(bearer(request).encode(), settings.backend_tool_token.get_secret_value().encode()):
        raise ApiError(401, "UNAUTHORIZED", "A valid service credential is required.")
    token = request.headers.get("x-delegation-token", "")
    try:
        if len(token) > 4096:
            raise ValueError()
        payload, signature = token.split(".")
        expected = hmac.new(settings.delegation_signing_secret.get_secret_value().encode(), payload.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(signature.encode(), encode_part(expected).encode()):
            raise ValueError()
        raw = base64.b64decode(payload + "=" * (-len(payload) % 4), altchars=b"-_", validate=True)
        claims = DelegationClaims.model_validate(json.loads(raw))
        now = int(time.time())
        if not claims.issued_at <= now < claims.expires_at or not 0 < claims.expires_at - claims.issued_at <= 60:
            raise ValueError()
        return claims
    except (ValueError, ValidationError, UnicodeError):
        raise ApiError(403, "FORBIDDEN", "A valid scoped delegation is required.") from None
