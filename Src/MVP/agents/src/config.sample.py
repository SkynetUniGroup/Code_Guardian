from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
"""Central configuration settings for the Code Guardian agents.

This class leverages Pydantic's `BaseSettings` to load configuration from environment
variables and/or a `.env` file, with sensible defaults for all fields. The settings
are frozen after initialization to prevent accidental modifications.

Attributes:
    internal_shared_secret (str): Shared secret for internal communication authentication.
        Defaults to an empty string. Alias: `INTERNAL_SHARED_SECRET`.
    backend_base_url (str): Base URL of the backend service. Defaults to
        `http://backend:3000`. Alias: `BACKEND_BASE_URL`.
    backend_api_prefix (str): Global API prefix used by the backend, including all routes
        (e.g., `/api/v1`). This value is used in URL construction and HMAC signing. Defaults to
        `/api/v1`. Alias: `BACKEND_API_PREFIX`.
    prompts_dir (str): Directory path where prompt templates are stored. Defaults to
        `/app/prompts`. Alias: `PROMPTS_DIR`.
    mongo_uri (str): MongoDB connection URI for LangGraph checkpointer. Defaults to
        `mongodb://mongo:27017/codeguardian`. Alias: `MONGO_URI`.
    llm_provider (str): Provider of the LLM service (e.g., `bedrock`, `openai`). Defaults to
        `bedrock`. Alias: `LLM_PROVIDER`.
    llm_api_key (str): API key for the LLM provider. Defaults to an empty string.
        Alias: `LLM_API_KEY`.
    llm_base_url (str): Base URL for the LLM provider's API. Defaults to
        `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`. Alias: `LLM_BASE_URL`.
    llm_model_general (str): General-purpose LLM model identifier. Defaults to
        `qwen3-32b`. Alias: `LLM_MODEL_GENERAL`.
    llm_model_security (str): Security-focused LLM model identifier. Defaults to
        `qwen3-coder-30b-a3b-instruct`. Alias: `LLM_MODEL_SECURITY`.
    aws_region (str): AWS region for Bedrock or other AWS services. Defaults to
        `eu-south-1`. Alias: `AWS_REGION`.
    max_output_tokens (int): Maximum number of tokens the LLM can generate in a single
        response. Defaults to `4096`.
    max_scope_chars (int): Maximum number of characters allowed in the analysis scope.
        Defaults to `100,000`. Alias: `MAX_SCOPE_CHARS`.
    changelog_min_readability (float): Minimum readability score for changelog generation.
        Defaults to `50.0`. Alias: `CHANGELOG_MIN_READABILITY`.
    security_max_output_tokens (int): Maximum tokens for security-related LLM responses.
        Defaults to `8000`.
    security_temperature (float): Temperature setting for security-related LLM responses.
        Lower values make outputs more deterministic. Defaults to `0.1`.
    max_tool_rounds (int): Maximum number of tool interaction rounds allowed in a single
        operation. Defaults to `8`. Alias: `MAX_TOOL_ROUNDS`.
    TIMEOUTS_BY_OPERATION (dict[str, int]): Timeouts (in seconds) for specific operations.
        Keys are operation names (e.g., `DOCS_INLINE`, `SECURITY_OWASP`), and values are
        timeout durations. Defaults are provided for all operations.
    redis_url (str): Redis connection URL for queues and storage. Defaults to
        `redis://redis:6379`. Alias: `REDIS_URL`.
    enable_sast_semgrep (bool): Flag to enable/disable Semgrep static analysis. Defaults to
        `True`. Alias: `ENABLE_SAST_SEMGREP`.
    semgrep_timeout_s (int): Timeout (in seconds) for Semgrep scans. Defaults to `120`.
        Alias: `SEMGREP_TIMEOUT_S`.
    sast_max_findings_llm (int): Maximum number of Semgrep findings to submit to the LLM
        for evaluation. Defaults to `40`. Alias: `SAST_MAX_FINDINGS_LLM`.
    sast_max_files (int): Maximum number of files to download for Semgrep scans. Defaults to
        `200`. Alias: `SAST_MAX_FILES`.
    enable_sonarqube (bool): Flag to enable/disable SonarQube integration. Defaults to
        `False`. Alias: `ENABLE_SONARQUBE`.
    sonar_cache_ttl_s (int): Time-to-live (in seconds) for cached SonarQube results.
        Defaults to `86400` (24 hours). Alias: `SONAR_CACHE_TTL_S`.
"""
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
        # Bedrock selector: ADR-AWS-1 enforces IAM Task Roles, no static API key
"""Validates and returns the LLM API key based on the provider.

For AWS Bedrock, this method returns an empty string as IAM Task Roles are used
(per ADR-AWS-1). For other providers, it checks if the `llm_api_key` is configured
and raises a `RuntimeError` if it is missing.

Returns:
    str: The LLM API key, or an empty string if not required (e.g., for Bedrock).

Raises:
    RuntimeError: If the `llm_api_key` is not configured and the provider is not Bedrock.
"""
        if self.llm_provider.lower() == "bedrock":
            return ""

        if not self.llm_api_key:
            raise RuntimeError("LLM_API_KEY not configured. Required for ManagedAPIProvider.")
        return self.llm_api_key


settings = Settings()
