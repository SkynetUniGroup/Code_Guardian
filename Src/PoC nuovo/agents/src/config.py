"""Configurazione centrale, letta da variabili d'ambiente.
Usa pydantic-settings per la validazione automatica.
"""

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        frozen=True,
        extra="ignore",
    )

    # --- Sicurezza e Comunicazione Interna (Appendice B) ---
    internal_shared_secret: str = Field(default="", alias="INTERNAL_SHARED_SECRET")
    backend_base_url: str = Field(default="http://backend:3000", alias="BACKEND_BASE_URL")
    prompts_dir: str = Field(default="/app/prompts", alias="PROMPTS_DIR")

    # --- Configurazioni Modelli LLM ---
    llm_provider: str = Field(default="managed", alias="LLM_PROVIDER")
    llm_api_key: str = Field(default="", alias="LLM_API_KEY")
    # Endpoint OpenAI-compatibile tipico per DashScope/Qwen
    llm_base_url: str = Field(default="https://dashscope-intl.aliyuncs.com/compatible-mode/v1", alias="LLM_BASE_URL")
    # Tag del modello su cloud, non tag locale
    llm_model: str = Field(default="qwen2.5-coder-32b-instruct", alias="LLM_MODEL")

    # --- Limiti Operativi ---
    agent_timeout_s: int = 90
    max_output_tokens: int = 4096
    max_scope_chars: int = 180_000

    # --- Limiti dedicati agli agenti di sicurezza (OWASP/Policy scan) ---
    # Le scansioni di sicurezza esplorano piu' file via tool-calling e beneficiano
    # di un budget di tempo maggiore, output piu' ampio e bassa temperatura per
    # ridurre l'aleatorieta' dei finding tra un'esecuzione e l'altra.
    security_agent_timeout_s: int = 180
    security_max_output_tokens: int = 6000
    security_temperature: float = 0.1

    # --- Code e Storage ---
    redis_url: str = Field(default="redis://redis:6379", alias="REDIS_URL")

    def require_llm_key(self) -> str:
        """Restituisce la chiave API o lancia un'eccezione chiara se assente."""
        if not self.llm_api_key:
            raise RuntimeError("LLM_API_KEY non configurata. Necessaria per il ManagedAPIProvider.")
        return self.llm_api_key

settings = Settings()