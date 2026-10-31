"""Environment-based configuration. Secrets come only from env / .env, never from code."""

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Backend -> AI bearer credential (checked on every /internal/v1/generate call).
    ai_service_token: SecretStr
    # AI -> backend tool gateway (used from Phase 4).
    backend_tool_base_url: str = "http://100.83.115.82:8000"
    backend_tool_token: SecretStr | None = None
    # Gemini (used from Phase 2).
    gemini_api_key: SecretStr | None = None
    gemini_model: str | None = None

    # Time budgets in seconds, from the contract.
    workflow_budget_s: float = 22.0
    tool_call_timeout_s: float = 3.0
    gemini_budget_s: float = 15.0

    # JSONL file for per-turn telemetry (IDs, outcome, codes, timing only). Unset = log only.
    telemetry_path: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
