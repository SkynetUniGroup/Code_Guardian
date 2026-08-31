"""Central configuration loaded from environment variables.

Uses pydantic-settings for automatic validation.
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / '.env'


class Settings(BaseSettings):
    """Configuration settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding='utf-8',
        frozen=True,
        extra='ignore',
    )

    # Security and Internal Communication
    internal_shared_secret: str = Field(default='', alias='INTERNAL_SHARED_SECRET')
    backend_base_url: str = Field(default='http://backend:3000', alias='BACKEND_BASE_URL')
    prompts_dir: str = Field(default='/app/prompts', alias='PROMPTS_DIR')

    # LangGraph Checkpointer (MVP)
    mongo_uri: str = Field(default='mongodb://mongo:27017/codeguardian', alias='MONGO_URI')

    # LLM Models Configuration
    llm_provider: str = Field(default='bedrock', alias='LLM_PROVIDER')
    llm_api_key: str = Field(default='', alias='LLM_API_KEY')
    
    # Typical OpenAI-compatible endpoint for DashScope/Qwen
    llm_base_url: str = Field(
        default='https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 
        alias='LLM_BASE_URL'
    )
    
    # Cloud model tag, not local tag
    llm_model_general: str = Field(default='qwen3-32b', alias='LLM_MODEL_GENERAL')
    llm_model_security: str = Field(
        default='qwen3-coder-30b-a3b-instruct', alias='LLM_MODEL_SECURITY'
    )

    aws_region: str = Field(default='eu-south-1', alias='AWS_REGION')

    # Operational Limits
    max_output_tokens: int = 4096
    max_scope_chars: int = Field(default=60_000, alias='MAX_SCOPE_CHARS')
    changelog_min_readability: float = Field(default=50.0, alias='CHANGELOG_MIN_READABILITY')

    # Dedicated limits for security agents (OWASP/Policy scan)
    security_max_output_tokens: int = 8000
    security_temperature: float = 0.1
    max_tool_rounds: int = Field(default=8, alias='MAX_TOOL_ROUNDS')

    # Specific timeouts for OperationCode
    TIMEOUTS_BY_OPERATION: dict[str, int] = {
        'DOCS_INLINE': 90,
        'DOCS_README': 150,
        'DOCS_API': 150,
        'SECURITY_OWASP': 180,
        'SECURITY_POLICY': 120,
        'CHANGELOG_TECHNICAL': 90,
        'CHANGELOG_BUSINESS': 120
    }

    # Queues and Storage
    redis_url: str = Field(default='redis://redis:6379', alias='REDIS_URL')

    def require_llm_key(self) -> str:
        """Returns the API key or raises a clear exception if missing, ignoring Bedrock.

        Returns:
            str: The configured LLM API key.

        Raises:
            RuntimeError: If the key is missing and the provider is not Bedrock.
        """
        # Bedrock selector: ADR-AWS-1 enforces IAM Task Roles, no static API key
        if self.llm_provider.lower() == 'bedrock':
            return ''

        if not self.llm_api_key:
            raise RuntimeError('LLM_API_KEY not configured. Required for ManagedAPIProvider.')
        return self.llm_api_key


settings = Settings()