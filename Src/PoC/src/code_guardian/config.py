"""Configurazione centrale, letta da variabili d'ambiente.

Passare da un fornitore di modello all'altro (o rientrare su AWS Bedrock in
produzione) e' una modifica di CONFIGURAZIONE, non di codice.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _get(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name, default)
    return v.strip() if isinstance(v, str) else v


@dataclass(frozen=True)
class Settings:
    # "anthropic" -> API dirette (alternativa a Bedrock, indisponibile)
    # "ollama"    -> modello locale, offline, per sviluppo
    # "fake"      -> risposte registrate, per i test
    llm_provider: str = field(default_factory=lambda: _get("LLM_PROVIDER", "anthropic"))
    llm_model: str = field(default_factory=lambda: _get("LLM_MODEL", "claude-sonnet-4-6"))
    anthropic_api_key: str | None = field(default_factory=lambda: _get("ANTHROPIC_API_KEY"))

    ollama_base_url: str = field(default_factory=lambda: _get("OLLAMA_BASE_URL", "http://localhost:11434"))
    ollama_model: str = field(default_factory=lambda: _get("OLLAMA_MODEL", "qwen2.5-coder:7b"))

    # RQ.7: un singolo agente non deve superare i 45 secondi.
    agent_timeout_s: int = field(default_factory=lambda: int(_get("AGENT_TIMEOUT_S", "45")))
    max_output_tokens: int = field(default_factory=lambda: int(_get("MAX_OUTPUT_TOKENS", "4096")))

    # RV.6: linguaggi supportati.
    supported_extensions: tuple[str, ...] = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".py")

    # Limite dell'ambito, per non eccedere la finestra di contesto.
    max_scope_chars: int = field(default_factory=lambda: int(_get("MAX_SCOPE_CHARS", "180000")))

    def require_anthropic_key(self) -> str:
        if not self.anthropic_api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY non impostata. Esporta la chiave, oppure usa "
                "LLM_PROVIDER=ollama per lavorare offline."
            )
        return self.anthropic_api_key


settings = Settings()
