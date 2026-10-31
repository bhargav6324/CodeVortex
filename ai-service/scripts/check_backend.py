"""Check that the backend is reachable from this machine over Tailscale.

Usage (from ai-service/):  .venv/Scripts/python scripts/check_backend.py

Only calls GET /health, which needs no credentials. Tool calls need a delegation token
that only the backend can mint, so they are exercised end to end in a later phase.
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.settings import Settings  # noqa: E402


def main() -> int:
    base_url = Settings.model_fields["backend_tool_base_url"].default
    try:
        base_url = Settings().backend_tool_base_url
    except Exception:
        pass  # .env not set up yet: fall back to the contract's frozen URL

    url = base_url.rstrip("/") + "/health"
    print(f"GET {url}")
    try:
        resp = httpx.get(url, timeout=5)
    except httpx.HTTPError as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        print("Check the backend is running with --host 0.0.0.0 on port 8000 and that its firewall allows Tailscale.")
        return 1

    print(f"HTTP {resp.status_code}  X-Contract-Version={resp.headers.get('x-contract-version')}")
    print(resp.text[:500])
    ok = resp.status_code == 200 and resp.headers.get("x-contract-version") == "1.0.0"
    print("OK" if ok else "UNEXPECTED: expected 200 and X-Contract-Version 1.0.0")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
