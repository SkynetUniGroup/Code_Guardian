"""Central configuration module for Code Guardian agents.

This module provides the Settings class which manages all application configuration
loaded from environment variables using pydantic-settings for automatic validation.

The settings include LLM provider configurations, operational limits, timeout
mappings, and various service integrations (MongoDB, Redis, SonarQube, Semgrep).

Note:
    All settings are loaded from environment variables with fallbacks to default
    values defined in the Settings class. The .env file is also supported via
    pydantic-settings.
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    """Configuration settings loaded from environment variables.

    Central class for managing all application configuration. Uses Pydantic for
    validation and environment variable loading with support for .env files.

    Attributes:
        model_config (SettingsConfigDict): Pydantic configuration for settings management.
        internal_shared_secret (str): Secret key for internal service authentication.
        backend_base_url (str): Base URL for the backend service.
        backend_api_prefix (str): API prefix used by the backend.
        prompts_dir (str): Directory containing prompt templates.
        mongo_uri (str): MongoDB connection URI for checkpointer.
        llm_provider (str): LLM provider to use (bedrock or managed).
        llm_api_key (str): API key for the LLM provider.
        llm_base_url (str): Base URL for the LLM API endpoint.
        llm_model_general (str): Default model for general operations.
        llm_model_security (str): Default model for security operations.
        aws_region (str): AWS region for Bedrock.
        max_output_tokens (int): Maximum tokens for LLM output.
        max_scope_chars (int): Maximum characters for prompt context.
        changelog_min_readability (float): Minimum readability score for changelog.
        security_max_output_tokens (int): Maximum tokens for security operations.
        max_tool_rounds (int): Maximum number of tool rounds.
        TIMEOUTS_BY_OPERATION (dict[str, int]): Operation-specific timeout mappings.
        redis_url (str): Redis connection URL.
        enable_sast_semgrep (bool): Whether SAST semgrep analysis is enabled.
        semgrep_timeout_s (int): Timeout for semgrep scanning.
        sast_max_findings_llm (int): Maximum findings to send to LLM.
        sast_max_files (int): Maximum files to download for scanning.
        enable_sonarqube (bool): Whether SonarQube integration is enabled.
        sonar_cache_ttl_s (int): SonarQube cache TTL in seconds.
    """

    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        frozen=True,
        extra="ignore",
    )

    # Security and Internal Communication
    internal_shared_secret: str = Field(default="", alias="INTERNAL_SHARED_SECRET")
    backend_base_url: str = Field(default="http://backend:3000", alias="BACKEND_BASE_URL")
    # The backend mounts all routes under a global prefix
    # (main.ts: app.setGlobalPrefix("api/v1")), /internal/* included. The value
    # goes into both the called URL and the HMAC-signed message, because
    # InternalAuthGuard signs request.path, which includes the prefix.
    backend_api_prefix: str = Field(default="/api/v1", alias="BACKEND_API_PREFIX")
    prompts_dir: str = Field(default="/app/prompts", alias="PROMPTS_DIR")

    # LangGraph Checkpointer (MVP)
    mongo_uri: str = Field(default="mongodb://mongo:27017/codeguardian", alias="MONGO_URI")

    # LLM Models Configuration
    llm_provider: str = Field(default="bedrock", alias="LLM_PROVIDER")
    llm_api_key: str = Field(default="", alias="LLM_API_KEY")

    # Typical OpenAI-compatible endpoint for DashScope/Qwen
    llm_base_url: str = Field(
        default="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        alias="LLM_BASE_URL",
    )

    # Cloud model tag, not local tag
    llm_model_general: str = Field(default="qwen3-32b", alias="LLM_MODEL_GENERAL")
    llm_model_security: str = Field(
        default="qwen3-coder-30b-a3b-instruct", alias="LLM_MODEL_SECURITY"
    )

    aws_region: str = Field(default="eu-south-1", alias="AWS_REGION")

    # Operational Limits
    max_output_tokens: int = 4096
    # DOCS_API must describe an entire API surface in a single JSON: with
    # the generic cap the response gets truncated mid-object and parsing
    # always fails, even after retries (same cap every time).
    docs_api_max_output_tokens: int = Field(default=8000, alias="DOCS_API_MAX_OUTPUT_TOKENS")
    max_scope_chars: int = Field(default=100_000, alias="MAX_SCOPE_CHARS")
    changelog_min_readability: float = Field(default=50.0, alias="CHANGELOG_MIN_READABILITY")

    # Dedicated limits for security agents (OWASP/Policy scan)
    security_max_output_tokens: int = 8000
    security_temperature: float = 0.1
    max_tool_rounds: int = Field(default=12, alias="MAX_TOOL_ROUNDS")

    # Specific timeouts for OperationCode
    TIMEOUTS_BY_OPERATION: dict[str, int] = {
        "DOCS_INLINE": 90,
        "DOCS_README": 150,
        "DOCS_API": 150,
        "SECURITY_OWASP": 180,
        "SECURITY_POLICY": 120,
        "CHANGELOG_TECHNICAL": 90,
        "CHANGELOG_BUSINESS": 120,
    }

    # Queues and Storage
    redis_url: str = Field(default="redis://redis:6379", alias="REDIS_URL")

    # ─────────────────── Static analysis (Semgrep) ───────────────────
    # Deterministic phase that precedes the LLM in SECURITY_OWASP: Semgrep finds
    # the candidates, the model judges them one by one.
    enable_sast_semgrep: bool = Field(default=True, alias="ENABLE_SAST_SEMGREP")
    # Cap on the scanning time alone. Must sit comfortably below the
    # operation budget (SECURITY_OWASP: 180s), because after the scan
    # the slowest part still remains, namely the model invocation.
    semgrep_timeout_s: int = Field(default=120, alias="SEMGREP_TIMEOUT_S")
    # How many findings are submitted to the model. Findings above this
    # threshold remain counted in the summary but without a verdict: it is a
    # cost and context-window limit, not an analysis limit.
    sast_max_findings_llm: int = Field(default=40, alias="SAST_MAX_FINDINGS_LLM")
    # How many files at most are downloaded for scanning. Each file is
    # an HTTP call to the backend facade (and an AccessLog line, and a
    # GitHub call): on a large repository, without a cap, the collection
    # alone would blow the operation budget before even starting.
    sast_max_files: int = Field(default=200, alias="SAST_MAX_FILES")

    # ─────────────────────────── SonarQube ───────────────────────────
    # Disabled by default: requires a SonarQube/SonarCloud instance and
    # per-project credentials, which in the MVP have no place to be
    # stored yet (the backend only accepts the GITHUB provider).
    enable_sonarqube: bool = Field(default=False, alias="ENABLE_SONARQUBE")
    sonar_cache_ttl_s: int = Field(default=86400, alias="SONAR_CACHE_TTL_S")

    def require_llm_key(self) -> str:
        """Returns the API key or raises a clear exception if missing, ignoring Bedrock.

        For Bedrock provider, returns empty string as AWS uses IAM Task Roles.
        For managed providers (OpenAI-compatible), validates that LLM_API_KEY is configured.

        Returns:
            str: The configured LLM API key, or empty string for Bedrock.

        Raises:
            RuntimeError: If the key is missing and the provider is not Bedrock.
        """
        # Bedrock selector: ADR-AWS-1 enforces IAM Task Roles, no static API key
        if self.llm_provider.lower() == "bedrock":
            return ""

        if not self.llm_api_key:
            raise RuntimeError("LLM_API_KEY not configured. Required for ManagedAPIProvider.")
        return self.llm_api_key


settings = Settings()
"""Global settings instance.

This singleton instance is loaded once at module import time and cached for
all subsequent uses throughout the application. All agent modules import
this instance to access configuration values.
"""
