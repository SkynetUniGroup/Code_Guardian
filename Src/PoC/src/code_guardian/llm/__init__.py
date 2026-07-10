"""Realizzazioni della porta `LLMProvider`.

Sono intercambiabili: il grafo non sa quale sta usando. Aggiungere
`BedrockProvider` quando AWS sara' disponibile significa aggiungere una classe
qui e una riga in `build_provider`, senza toccare grafo ne' agenti.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from ..config import settings
from ..errors import ParseError, TimeoutErr
from ..ports import LLMProvider, Prompt

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


class AnthropicProvider(LLMProvider):
    """Chiamata diretta all'API Anthropic. Unica comunicazione di rete del PoC.

    Nota di sicurezza (RS.4): selezionare un livello di servizio che garantisca
    che il codice sorgente non venga conservato ne' usato per l'addestramento.
    """

    def __init__(self, model: str | None = None, api_key: str | None = None) -> None:
        self._model = model or settings.llm_model
        self._api_key = api_key or settings.require_anthropic_key()

    def complete(self, prompt: Prompt, timeout_s: int) -> str:
        body = json.dumps(
            {
                "model": self._model,
                "max_tokens": settings.max_output_tokens,
                "system": prompt.system,
                "messages": [{"role": "user", "content": prompt.user}],
            }
        ).encode("utf-8")

        req = urllib.request.Request(
            ANTHROPIC_URL,
            data=body,
            headers={
                "content-type": "application/json",
                "x-api-key": self._api_key,
                "anthropic-version": ANTHROPIC_VERSION,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except TimeoutError as exc:
            raise TimeoutErr(f"Nessuna risposta entro {timeout_s}s.") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError):
                raise TimeoutErr(f"Nessuna risposta entro {timeout_s}s.") from exc
            raise ParseError(f"Chiamata al modello fallita: {reason}") from exc

        return _join_text_blocks(payload.get("content", []))


class OllamaProvider(LLMProvider):
    """Fornitore locale: sviluppo e prove senza chiavi ne' costi."""

    def __init__(self, model: str | None = None, base_url: str | None = None) -> None:
        self._model = model or settings.ollama_model
        self._base = (base_url or settings.ollama_base_url).rstrip("/")

    def complete(self, prompt: Prompt, timeout_s: int) -> str:
        body = json.dumps(
            {
                "model": self._model,
                "system": prompt.system,
                "prompt": prompt.user,
                "stream": False,
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            f"{self._base}/api/generate",
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except TimeoutError as exc:
            raise TimeoutErr(f"Nessuna risposta entro {timeout_s}s.") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError):
                raise TimeoutErr(f"Nessuna risposta entro {timeout_s}s.") from exc
            raise ParseError(f"Ollama non raggiungibile: {reason}") from exc
        return payload.get("response", "")


class FakeLLMProvider(LLMProvider):
    """Componente di prima classe, non un ripiego.

    Consente ai tre sviluppatori di testare il proprio agente offline, in modo
    deterministico e a costo zero, prima ancora che le chiavi API esistano.
    """

    def __init__(self, *responses: str, raise_timeout: bool = False) -> None:
        self._responses = list(responses) or [""]
        self._raise_timeout = raise_timeout
        self.calls: list[Prompt] = []

    def complete(self, prompt: Prompt, timeout_s: int) -> str:
        self.calls.append(prompt)
        if self._raise_timeout:
            raise TimeoutErr(f"Nessuna risposta entro {timeout_s}s.")
        if len(self._responses) > 1:
            return self._responses.pop(0)
        return self._responses[0]


def _join_text_blocks(content: list[dict]) -> str:
    return "\n".join(b.get("text", "") for b in content if b.get("type") == "text")


def build_provider(name: str | None = None) -> LLMProvider:
    """Fabbrica: l'unico punto che traduce configurazione in classe concreta."""
    name = (name or settings.llm_provider).lower()
    if name == "anthropic":
        return AnthropicProvider()
    if name == "ollama":
        return OllamaProvider()
    if name == "fake":
        # Pilotabile da riga di comando per gli smoke test:
        #   FAKE_RESPONSE="$(cat risposta.json)" python -m code_guardian.cli owasp ...
        import os

        return FakeLLMProvider(os.environ.get("FAKE_RESPONSE", "{}"))
    raise ValueError(f"Fornitore di modello sconosciuto: {name!r}")
