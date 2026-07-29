"""Configurazione centrale, letta da variabili d'ambiente (e da `.env`).

Passare da un fornitore di modello all'altro (o rientrare su AWS Bedrock in
produzione) e' una modifica di CONFIGURAZIONE, non di codice.

`Settings` e' un `BaseSettings` di pydantic-settings: ogni campo mappa da se'
sulla variabile d'ambiente omonima (case-insensitive, es. `llm_provider` <-
`LLM_PROVIDER`). Il file `.env` viene risolto con un percorso ASSOLUTO
(calcolato da `Path(__file__)`, come fa gia' `scripts/measure_accuracy.py` per
i propri path) cosi' viene trovato anche lanciando i comandi da un'altra
cartella. Se `.env` manca (il caso normale in CI e nei test) non e' un
errore: si usano i default. Le variabili gia' presenti in `os.environ` hanno
precedenza su quelle nel file (ordine di default di pydantic-settings).
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        frozen=True,
        extra="ignore",
    )

    # "anthropic" -> API dirette (alternativa a Bedrock, indisponibile)
    # "ollama"    -> modello locale, offline, per sviluppo
    # "fake"      -> risposte registrate, per i test
    llm_provider: str = "anthropic"
    llm_model: str = "claude-sonnet-4-6"
    anthropic_api_key: str | None = None

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5-coder:7b"

    # RQ.7: un singolo agente non deve superare i 45 secondi. Pensato per
    # Claude (cloud): un modello locale via Ollama e' strutturalmente piu'
    # lento (misurato: oltre 60s anche su Apple Silicon con accelerazione
    # Metal per una scansione OWASP), quindi ha un default piu' alto e
    # separato invece di sforare sistematicamente RQ.7.
    agent_timeout_s: int = 45
    ollama_agent_timeout_s: int = 300
    max_output_tokens: int = 4096

    # RV.6: linguaggi supportati.
    supported_extensions: tuple[str, ...] = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".py")

    # Limite dell'ambito, per non eccedere la finestra di contesto.
    max_scope_chars: int = 180_000

    def require_anthropic_key(self) -> str:
        if not self.anthropic_api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY non impostata. Esporta la chiave, oppure usa "
                "LLM_PROVIDER=ollama per lavorare offline."
            )
        return self.anthropic_api_key


settings = Settings()
