"""Central configuration loaded from environment variables.

Uses pydantic-settings for automatic validation.
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"


class Settings(BaseSettings):
"""Configuration settings loaded from environment variables.
"""Configuration settings loaded from environment variables.

Central class for managing all application configuration. Uses Pydantic for
validation and environment variable loading with support for .env files.

Attributes:
    model_config (SettingsConfigDict): Pydantic configuration for settings management.
    internal_shared_secret (str): Secret key for internal service authentication.
        Loaded from INTERNAL_SHARED_SECRET environment variable.
    backend_base_url (str): Base URL for the backend service.
        Loaded from BACKEND_BASE_URL environment variable. Defaults to "http://backend:3000".
    backend_api_prefix (str): API prefix used by the backend.
        Loaded from BACKEND_API_PREFIX environment variable. Defaults to "/api/v1".
        Note: This value is included in both the URL and HMAC-signed messages.
    prompts_dir (str): Directory containing prompt templates.
        Loaded from PROMPTS_DIR environment variable. Defaults to "/app/prompts".
    mongo_uri (str): MongoDB connection URI for checkpointer.
        Loaded from MONGO_URI environment variable. Defaults to "mongodb://mongo:27017/codeguardian".
    llm_provider (str): LLM provider to use (bedrock or managed).
        Loaded from LLM_PROVIDER environment variable. Defaults to "bedrock".
    llm_api_key (str): API key for the LLM provider.
        Loaded from LLM_API_KEY environment variable. Defaults to empty string.
    llm_base_url (str): Base URL for the LLM API endpoint.
        Loaded from LLM_BASE_URL environment variable. Defaults to "https://dashscope-intl.aliyuncs.com/compatible-mode/v1".
    llm_model_general (str): Default model for general operations.
        Loaded from LLM_MODEL_GENERAL environment variable. Defaults to "qwen3-32b".
    llm_model_security (str): Default model for security operations.
        Loaded from LLM_MODEL_SECURITY environment variable. Defaults to "qwen3-coder-30b-a3b-instruct".
    aws_region (str): AWS region for Bedrock.
        Loaded from AWS_REGION environment variable. Defaults to "eu-south-1".
    max_output_tokens (int): Maximum tokens for LLM output. Defaults to 4096.
    max_scope_chars (int): Maximum characters for prompt context.
        Loaded from MAX_SCOPE_CHARS environment variable. Defaults to 100,000.
    changelog_min_readability (float): Minimum readability score for changelog.
        Loaded from CHANGELOG_MIN_READABILITY environment variable. Defaults to 50.0.
    security_max_output_tokens (int): Maximum tokens for security operations. Defaults to 8000.
    security_temperature (float): Temperature setting for security operations. Defaults to 0.1.
    max_tool_rounds (int): Maximum number of tool rounds.
        Loaded from MAX_TOOL_ROUNDS environment variable. Defaults to 8.
    TIMEOUTS_BY_OPERATION (dict[str, int]): Operation-specific timeout mappings.
        Contains timeouts for various operations like DOCS_INLINE, SECURITY_OWASP, etc.
    redis_url (str): Redis connection URL.
        Loaded from REDIS_URL environment variable. Defaults to "redis://redis:6379".
    enable_sast_semgrep (bool): Whether SAST semgrep analysis is enabled.
        Loaded from ENABLE_SAST_SEMGREP environment variable. Defaults to True.
    semgrep_timeout_s (int): Timeout for semgrep scanning in seconds.
        Loaded from SEMGREP_TIMEOUT_S environment variable. Defaults to 120.
    sast_max_findings_llm (int): Maximum findings to send to LLM for analysis.
        Loaded from SAST_MAX_FINDINGS_LLM environment variable. Defaults to 40.
    sast_max_files (int): Maximum files to download for scanning.
        Loaded from SAST_MAX_FILES environment variable. Defaults to 200.
    enable_sonarqube (bool): Whether SonarQube integration is enabled.
        Loaded from ENABLE_SONARQUBE environment variable. Defaults to False.
    sonar_cache_ttl_s (int): SonarQube cache TTL in seconds.
        Loaded from SONAR_CACHE_TTL_S environment variable. Defaults to 86400.
"""

Central class for managing all application configuration. Uses Pydantic for
validation and environment variable loading with support for .env files.

Attributes:
    model_config (SettingsConfigDict): Pydantic configuration for settings management.
    internal_shared_secret (str): Secret key for internal service authentication.
        Loaded from INTERNAL_SHARED_SECRET environment variable.
    backend_base_url (str): Base URL for the backend service.
        Loaded from BACKEND_BASE_URL environment variable. Defaults to "http://backend:3000".
    backend_api_prefix (str): API prefix used by the backend.
        Loaded from BACKEND_API_PREFIX environment variable. Defaults to "/api/v1".
        Note: This value is included in both the URL and HMAC-signed messages.
    prompts_dir (str): Directory containing prompt templates.
        Loaded from PROMPTS_DIR environment variable. Defaults to "/app/prompts".
    mongo_uri (str): MongoDB connection URI for checkpointer.
        Loaded from MONGO_URI environment variable. Defaults to "mongodb://mongo:27017/codeguardian".
    llm_provider (str): LLM provider to use (bedrock or managed).
        Loaded from LLM_PROVIDER environment variable. Defaults to "bedrock".
    llm_api_key (str): API key for the LLM provider.
        Loaded from LLM_API_KEY environment variable. Defaults to empty string.
    llm_base_url (str): Base URL for the LLM API endpoint.
        Loaded from LLM_BASE_URL environment variable. Defaults to "https://dashscope-intl.aliyuncs.com/compatible-mode/v1".
    llm_model_general (str): Default model for general operations.
        Loaded from LLM_MODEL_GENERAL environment variable. Defaults to "qwen3-32b".
    llm_model_security (str): Default model for security operations.
        Loaded from LLM_MODEL_SECURITY environment variable. Defaults to "qwen3-coder-30b-a3b-instruct".
    aws_region (str): AWS region for Bedrock.
        Loaded from AWS_REGION environment variable. Defaults to "eu-south-1".
    max_output_tokens (int): Maximum tokens for LLM output. Defaults to 4096.
    max_scope_chars (int): Maximum characters for prompt context.
        Loaded from MAX_SCOPE_CHARS environment variable. Defaults to 100,000.
    changelog_min_readability (float): Minimum readability score for changelog.
        Loaded from CHANGELOG_MIN_READABILITY environment variable. Defaults to 50.0.
    security_max_output_tokens (int): Maximum tokens for security operations. Defaults to 8000.
    security_temperature (float): Temperature setting for security operations. Defaults to 0.1.
    max_tool_rounds (int): Maximum number of tool rounds.
        Loaded from MAX_TOOL_ROUNDS environment variable. Defaults to 8.
    TIMEOUTS_BY_OPERATION (dict[str, int]): Operation-specific timeout mappings.
        Contains timeouts for various operations like DOCS_INLINE, SECURITY_OWASP, etc.
    redis_url (str): Redis connection URL.
        Loaded from REDIS_URL environment variable. Defaults to "redis://redis:6379".
    enable_sast_semgrep (bool): Whether SAST semgrep analysis is enabled.
        Loaded from ENABLE_SAST_SEMGREP environment variable. Defaults to True.
    semgrep_timeout_s (int): Timeout for semgrep scanning in seconds.
        Loaded from SEMGREP_TIMEOUT_S environment variable. Defaults to 120.
    sast_max_findings_llm (int): Maximum findings to send to LLM for analysis.
        Loaded from SAST_MAX_FINDINGS_LLM environment variable. Defaults to 40.
    sast_max_files (int): Maximum files to download for scanning.
        Loaded from SAST_MAX_FILES environment variable. Defaults to 200.
    enable_sonarqube (bool): Whether SonarQube integration is enabled.
        Loaded from ENABLE_SONARQUBE environment variable. Defaults to False.
    sonar_cache_ttl_s (int): SonarQube cache TTL in seconds.
        Loaded from SONAR_CACHE_TTL_S environment variable. Defaults to 86400.
"""
    """Configuration settings loaded from environment variables.

    Central class for managing all application configuration. Uses Pydantic for
    validation and environment variable loading with support for .env files.

    Attributes:
        model_config: Pydantic configuration for settings management.
        internal_shared_secret: Secret key for internal service authentication.
        backend_base_url: Base URL for the backend service.
        backend_api_prefix: API prefix used by the backend.
        prompts_dir: Directory containing prompt templates.
        mongo_uri: MongoDB connection URI for checkpointer.
        llm_provider: LLM provider to use (bedrock or managed).
        llm_api_key: API key for the LLM provider.
        llm_base_url: Base URL for the LLM API endpoint.
        llm_model_general: Default model for general operations.
        llm_model_security: Default model for security operations.
        aws_region: AWS region for Bedrock.
        max_output_tokens: Maximum tokens for LLM output.
        max_scope_chars: Maximum characters for prompt context.
        changelog_min_readability: Minimum readability score for changelog.
        security_max_output_tokens: Maximum tokens for security operations.
        max_tool_rounds: Maximum number of tool rounds.
        TIMEOUTS_BY_OPERATION: Operation-specific timeout mappings.
        redis_url: Redis connection URL.
        enable_sast_semgrep: Whether SAST semgrep analysis is enabled.
        semgrep_timeout_s: Timeout for semgrep scanning.
        sast_max_findings_llm: Maximum findings to send to LLM.
        sast_max_files: Maximum files to download for scanning.
        enable_sonarqube: Whether SonarQube integration is enabled.
        sonar_cache_ttl_s: SonarQube cache TTL in seconds.
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
    # Il backend monta tutte le rotte sotto un prefisso globale
    # (main.ts: app.setGlobalPrefix("api/v1")), /internal/* incluse. Il valore
    # entra sia nell'URL chiamato sia nel messaggio firmato in HMAC, perche'
    # InternalAuthGuard firma request.path, che il prefisso ce l'ha dentro.
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
    max_scope_chars: int = Field(default=100_000, alias="MAX_SCOPE_CHARS")
    changelog_min_readability: float = Field(default=50.0, alias="CHANGELOG_MIN_READABILITY")

    # Dedicated limits for security agents (OWASP/Policy scan)
    security_max_output_tokens: int = 8000
    security_temperature: float = 0.1
    max_tool_rounds: int = Field(default=8, alias="MAX_TOOL_ROUNDS")

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

    # ─────────────────── Analisi statica (Semgrep) ───────────────────
    # Fase deterministica che precede l'LLM in SECURITY_OWASP: Semgrep trova i
    # candidati, il modello li giudica uno per uno.
    enable_sast_semgrep: bool = Field(default=True, alias="ENABLE_SAST_SEMGREP")
    # Tetto al tempo della sola scansione. Deve stare comodamente sotto il
    # budget dell'operazione (SECURITY_OWASP: 180s), perché dopo la scansione
    # resta ancora da fare la parte piu' lenta, cioe' l'invocazione del modello.
    semgrep_timeout_s: int = Field(default=120, alias="SEMGREP_TIMEOUT_S")
    # Quanti finding vengono sottoposti al modello. I finding oltre questa
    # soglia restano contati nel riepilogo ma senza verdetto: e' un limite di
    # costo e di finestra di contesto, non di analisi.
    sast_max_findings_llm: int = Field(default=40, alias="SAST_MAX_FINDINGS_LLM")
    # Quanti file al massimo vengono scaricati per la scansione. Ogni file e'
    # una chiamata HTTP alla facade del backend (e una riga di AccessLog, e una
    # chiamata a GitHub): su un repository grande, senza un tetto, la sola
    # raccolta sfonderebbe il budget dell'operazione prima ancora di iniziare.
    sast_max_files: int = Field(default=200, alias="SAST_MAX_FILES")

    # ─────────────────────────── SonarQube ───────────────────────────
    # Disattivato di default: richiede un'istanza SonarQube/SonarCloud e delle
    # credenziali per progetto, che nell'MVP non hanno ancora un posto dove
    # essere salvate (il backend accetta solo il provider GITHUB).
    enable_sonarqube: bool = Field(default=False, alias="ENABLE_SONARQUBE")
    sonar_cache_ttl_s: int = Field(default=86400, alias="SONAR_CACHE_TTL_S")

    def require_llm_key(self) -> str:
"""Returns the API key or raises a clear exception if missing, ignoring Bedrock.
"""Returns the API key or raises a clear exception if missing, ignoring Bedrock.

For Bedrock provider, returns empty string as AWS uses IAM Task Roles.
For managed providers (OpenAI-compatible), validates that LLM_API_KEY is configured.

Returns:
    str: The configured LLM API key, or empty string for Bedrock.

Raises:
    RuntimeError: If the key is missing and the provider is not Bedrock.
"""

For Bedrock provider, returns empty string as AWS uses IAM Task Roles.
For managed providers (OpenAI-compatible), validates that LLM_API_KEY is configured.

Returns:
    str: The configured LLM API key, or empty string for Bedrock.

Raises:
    RuntimeError: If the key is missing and the provider is not Bedrock.
"""
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


# Instantiate settings object for global access throughout the application.
# This is loaded once at module import time and cached for all subsequent uses.
