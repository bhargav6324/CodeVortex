import json
import os
from pathlib import Path
from typing import List, Literal, Optional
from urllib.parse import urlparse

from dotenv import load_dotenv
from pydantic import SecretStr, field_validator

from app.models import ContractModel, UTCString

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = ROOT / "fixtures/dataset.json"
DEFAULT_DRAFTS = ROOT / "fixtures/drafts.json"


class Reviewer(ContractModel):
    token: SecretStr
    actor_id: str
    role: str
    customer_ids: List[str]
    expires_at: UTCString

    @field_validator("role")
    @classmethod
    def reviewer_role(cls, value):
        if value != "reviewer":
            raise ValueError("Only reviewer credentials are supported")
        return value


class Settings(ContractModel):
    ai_service_base_url: str
    cors_origins: List[str]
    backend_tool_token: SecretStr
    ai_service_token: SecretStr
    delegation_signing_secret: SecretStr
    reviewers: List[Reviewer]
    delivery_mode: str
    storage_backend: Literal["memory"] = "memory"
    dataset_path: str = str(DEFAULT_DATASET)
    draft_fixture_path: Optional[str] = str(DEFAULT_DRAFTS)

    @field_validator("backend_tool_token", "ai_service_token", "delegation_signing_secret")
    @classmethod
    def strong_secret(cls, value):
        raw = value.get_secret_value()
        if len(raw) < 32 or raw.startswith(("<", "CHANGE")):
            raise ValueError("Provision a random secret of at least 32 characters")
        return value

    @field_validator("delivery_mode")
    @classmethod
    def mock_only(cls, value):
        if value != "mock_email":
            raise ValueError("Only mock_email delivery is supported")
        return value

    @field_validator("cors_origins")
    @classmethod
    def exact_origins(cls, values):
        if not values:
            raise ValueError("At least one explicit frontend origin is required")
        for value in values:
            parsed = urlparse(value)
            if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
                raise ValueError("CORS origins must be explicit http(s) origins without paths")
        return values

    @field_validator("reviewers")
    @classmethod
    def valid_reviewers(cls, values):
        if not values:
            raise ValueError("Provision at least one reviewer")
        tokens = [r.token.get_secret_value() for r in values]
        if len(set(tokens)) != len(tokens) or any(len(t) < 32 for t in tokens):
            raise ValueError("Reviewer tokens must be unique random secrets")
        return values


def load_settings() -> Settings:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
    try:
        dataset_path = os.environ.get("DATASET_PATH", str(DEFAULT_DATASET))
        settings = Settings.model_validate({
            "ai_service_base_url": os.environ["AI_SERVICE_BASE_URL"],
            "cors_origins": os.environ["CORS_ORIGINS"].split(","),
            "backend_tool_token": os.environ["BACKEND_TOOL_TOKEN"],
            "ai_service_token": os.environ["AI_SERVICE_TOKEN"],
            "delegation_signing_secret": os.environ["DELEGATION_SIGNING_SECRET"],
            "reviewers": json.loads(os.environ["REVIEWERS_JSON"]),
            "delivery_mode": os.environ["DELIVERY_MODE"],
            "storage_backend": os.environ.get("STORAGE_BACKEND", "memory"),
            "dataset_path": dataset_path,
            "draft_fixture_path": os.environ.get("DRAFT_FIXTURE_PATH", str(DEFAULT_DRAFTS) if dataset_path == str(DEFAULT_DATASET) else "") or None,
        })
    except (KeyError, ValueError) as exc:
        # Do not include validation inputs: those may contain credentials.
        raise RuntimeError("Invalid backend configuration. Check .env against .env.example.") from None
    secrets = [settings.ai_service_token.get_secret_value(), settings.backend_tool_token.get_secret_value(), settings.delegation_signing_secret.get_secret_value()]
    secrets.extend(r.token.get_secret_value() for r in settings.reviewers)
    if len(set(secrets)) != len(secrets):
        raise RuntimeError("Each service, signing and reviewer credential must be different.")
    return settings
