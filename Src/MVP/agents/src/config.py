from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Internal auth
    internal_shared_secret: str = "changeme"

    # Backend
    backend_base_url: str = "http://backend:3000"

    # Prompts
    prompts_dir: str = "prompts"

    # LLM
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_temperature: float = 0.2
    openai_max_tokens: int = 4096
    max_tool_rounds: int = 20
    agent_timeout_s: int = 180

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # SonarQube
    enable_sonarqube: bool = False
    sonar_cache_ttl_s: int = 86400

    # SAST / Semgrep
    enable_sast_semgrep: bool = True
    semgrep_timeout_s: int = 120
    sast_max_findings_llm: int = 40


settings = Settings()
