"""Contratto dati condiviso dai tre agenti (envelope `Report`).

Questo modulo NON contiene logica applicativa: contiene solo le strutture che
tutti gli agenti popolano e che il frontend/CLI consuma. E' il punto di
accordo del team: nessuno lo modifica da solo.

Nota implementativa: usiamo Pydantic v2 (`BaseModel`). I blocchi del corpo del
report (`Block`) e le remediation (`Remediation`) sono unioni discriminate sul
campo `kind`, cosi' Pydantic sa scegliere il modello giusto senza ambiguita'.
I modelli che nella versione a dataclass erano `frozen=True` restano
immutabili (`model_config = ConfigDict(frozen=True)`); le tuple immutabili
diventano liste, coerentemente con l'idioma Pydantic.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal, Union
import json

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# --------------------------------------------------------------------------
# Enumerazioni
# --------------------------------------------------------------------------

AgentName = Literal["docs", "owasp", "changelog"]
Status = Literal["completato", "avviso", "fallito", "annullato"]
Severity = Literal["info", "low", "medium", "high", "critical"]
ErrorType = Literal["timeout", "parse", "context_missing"]

SEVERITY_ORDER: tuple[str, ...] = ("info", "low", "medium", "high", "critical")


class _Immutable(BaseModel):
    """Base per i modelli che erano `@dataclass(frozen=True)`."""

    model_config = ConfigDict(frozen=True)


# --------------------------------------------------------------------------
# Contesto ed errore
# --------------------------------------------------------------------------


class Ref(_Immutable):
    """Riferimento di base del repository (branch, commit o PR)."""

    type: Literal["branch", "commit", "pr"] = "branch"
    value: str = "main"


class ContextRef(_Immutable):
    """Cio' che l'orchestratore (qui: la CLI) passa all'agente."""

    repo_url: str | None = None
    ref: Ref | None = None
    scope: list[str] = Field(default_factory=list)
    sprint_id: str | None = None


class ErrorInfo(_Immutable):
    type: ErrorType
    message: str


# --------------------------------------------------------------------------
# Remediation
# --------------------------------------------------------------------------


class TextRemediation(_Immutable):
    markdown: str
    kind: Literal["text"] = "text"


class SnippetRemediation(_Immutable):
    language: str
    code: str
    kind: Literal["snippet"] = "snippet"


Remediation = Annotated[Union[TextRemediation, SnippetRemediation], Field(discriminator="kind")]


# --------------------------------------------------------------------------
# Blocchi del corpo del report
# --------------------------------------------------------------------------


class Location(_Immutable):
    file: str
    start_line: int
    end_line: int

    @field_validator("start_line")
    @classmethod
    def _start_line_almeno_uno(cls, v: int) -> int:
        if v < 1:
            raise ValueError("start_line deve essere >= 1")
        return v

    @model_validator(mode="after")
    def _end_non_precede_start(self) -> "Location":
        if self.end_line < self.start_line:
            raise ValueError("end_line deve essere >= start_line")
        return self


class TextBlock(_Immutable):
    content: str
    format: Literal["markdown"] = "markdown"
    kind: Literal["text"] = "text"


class FindingBlock(_Immutable):
    category: str
    severity: Severity
    location: Location
    message: str
    remediation: Remediation | None = None
    kind: Literal["finding"] = "finding"


Block = Annotated[Union[TextBlock, FindingBlock], Field(discriminator="kind")]


# --------------------------------------------------------------------------
# Proposta di modifica (mai applicata: solo proposta -- RS.1)
# --------------------------------------------------------------------------


class FileChange(_Immutable):
    path: str
    unified_diff: str


class Proposal(_Immutable):
    kind: Literal["readme", "inline_doc", "api_doc", "remediation"]
    files: list[FileChange] = Field(default_factory=list)
    # Nel PoC resta sempre None: nessuna Pull Request viene aperta.
    pr_link: str | None = None


# --------------------------------------------------------------------------
# Envelope
# --------------------------------------------------------------------------


class Report(BaseModel):
    agent: AgentName
    operation: str
    context: ContextRef
    status: Status = "completato"
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    duration_ms: int = 0
    blocks: list[Block] = Field(default_factory=list)
    proposal: Proposal | None = None
    error: ErrorInfo | None = None

    # -- serializzazione ---------------------------------------------------

    def to_dict(self) -> dict:
        return self.model_dump(mode="json")

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    @property
    def findings(self) -> tuple[FindingBlock, ...]:
        return tuple(b for b in self.blocks if isinstance(b, FindingBlock))
