"""Provision local demo credentials without printing secrets or overwriting .env."""
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
expiry = (datetime.now(timezone.utc) + timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ')
reviewer = {"token": secrets.token_urlsafe(32), "actor_id": "REVIEWER001", "role": "reviewer",
            "customer_ids": ["CUST%03d" % n for n in range(1, 51)], "expires_at": expiry}
lines = ["AI_SERVICE_BASE_URL=http://100.114.163.7:8001",
         "CORS_ORIGINS=http://100.117.73.55:5173,http://localhost:5173", "DELIVERY_MODE=mock_email"]
for name in ("AI_SERVICE_TOKEN", "BACKEND_TOOL_TOKEN", "DELEGATION_SIGNING_SECRET"):
    lines.append(name + "=" + secrets.token_urlsafe(32))
lines.append("REVIEWERS_JSON='" + json.dumps([reviewer], separators=(',', ':')) + "'")
try:
    fd = os.open(root / '.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    raise SystemExit('Existing .env preserved. Update or rotate it explicitly if needed.')
with os.fdopen(fd, 'w') as stream:
    stream.write('\n'.join(lines) + '\n')
print('Created private local .env; reviewer token expires in 24 hours. No secrets printed.')
