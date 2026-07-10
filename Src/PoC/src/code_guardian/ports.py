"""Le tre porte del sistema (ports-and-adapters).

`AgentGraph` dipende ESCLUSIVAMENTE da questo modulo e da `models`.
Non conosce nessuna classe concreta: e' la CLI a iniettarle.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from .models import Block, ContextRef, Proposal, Report


# --------------------------------------------------------------------------
# Tipi di scambio fra i nodi
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class LoadedContext:
    """Cio' che un ContextLoader restituisce.

    `files` e' usato dagli agenti che leggono codice (Docs, OWASP);
    `payload` e' un contenitore libero per contesti non-codice (Changelog).
    """

    files: tuple[tuple[str, str], ...] = ()  # (path relativo, contenuto)
    payload: Any = None
    extra: dict[str, Any] = field(default_factory=dict)  # es. CLAUDE.md

    def is_empty(self) -> bool:
        return not self.files and not self.payload


@dataclass(frozen=True)
class Prompt:
    system: str
    user: str


@dataclass
class AgentState:
    """Lo stato che scorre lungo i cinque nodi del grafo."""

    context_ref: ContextRef
    loaded_context: LoadedContext | None = None
    prompt: Prompt | None = None
    raw_output: str | None = None
    blocks: tuple[Block, ...] = ()
    proposal: Proposal | None = None
    report: Report | None = None
    error: Exception | None = None


# --------------------------------------------------------------------------
# Porte
# --------------------------------------------------------------------------


class ContextLoader(ABC):
    """Porta 1: da dove l'agente prende il proprio contesto."""

    @abstractmethod
    def load(self, ref: ContextRef) -> LoadedContext: ...


class LLMProvider(ABC):
    """Porta 2: condivisa e identica per tutti gli agenti."""

    @abstractmethod
    def complete(self, prompt: Prompt, timeout_s: int) -> str: ...


class AgentProfile(ABC):
    """Porta 3: l'unico codice che varia davvero da un agente all'altro."""

    #: nome dell'agente, usato nel Report
    agent: str
    #: nome dell'operazione, usato nel Report
    operation: str

    @abstractmethod
    def build_prompt(self, ctx: LoadedContext) -> Prompt: ...

    @abstractmethod
    def parse_output(self, raw: str) -> tuple[tuple[Block, ...], Proposal | None]:
        """Restituisce (blocchi, proposta|None). Solleva ParseError se invalido."""
