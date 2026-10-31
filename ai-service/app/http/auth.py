"""Service authentication for backend -> AI calls.

The AI service checks its own bearer credential and that a delegation token is present.
It cannot verify or mint delegation tokens: it forwards them to the backend tool gateway,
which verifies the signature, scope and expiry.
"""

from __future__ import annotations

import hmac
import re
from dataclasses import dataclass

from fastapi import Depends, Header

from app.http.errors import ApiError
from app.settings import Settings, get_settings

# Opaque token: printable, no whitespace, bounded length. Anything else is a bad header format.
_TOKEN_RE = re.compile(r"^[\x21-\x7E]{1,4096}$")


@dataclass(frozen=True)
class ServiceCaller:
    delegation_token: str


def require_service_auth(
    authorization: str | None = Header(default=None),
    x_delegation_token: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> ServiceCaller:
    if authorization is None or x_delegation_token is None:
        raise ApiError("UNAUTHORIZED", "Missing service credential or delegation token.")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not _TOKEN_RE.fullmatch(token) or not _TOKEN_RE.fullmatch(x_delegation_token):
        raise ApiError("INVALID_REQUEST", "Malformed Authorization or X-Delegation-Token header.")

    expected = settings.ai_service_token.get_secret_value()
    if not hmac.compare_digest(token.encode(), expected.encode()):
        raise ApiError("UNAUTHORIZED", "Invalid service credential.")

    return ServiceCaller(delegation_token=x_delegation_token)
