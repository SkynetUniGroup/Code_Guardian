"""Contratto dati condiviso (Envelope Report).
Rispecchia esattamente il diagramma delle classi (Figura 4) delle specifiche.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal, Union, List, Optional
import json

from pydantic import BaseModel, ConfigDict, Field

# --- Enumerazioni Condivise ---
OperationCode = Literal[
    "DOCS_README", "DOCS_INLINE", "DOCS_API",
    "SECURITY_OWASP", "SECURITY_POLICY",
    "CHANGELOG_TECHNICAL", "CHANGELOG_BUSINESS"
]
ReportStatus = Literal["COMPLETED", "FAILED"]
ErrorKind = Literal["TIMEOUT", "PARSING", "UPSTREAM"]
Severity = Literal["info", "low", "medium", "high", "critical"]

SEVERITY_ORDER: tuple[str, ...] = ("info", "low", "medium", "high", "critical")


class _Immutable(BaseModel):
    """Base per i modelli immutabili."""
    model_config = ConfigDict(frozen=True)


# --- Errore e Proposta ---
class ReportError(_Immutable):
    kind: ErrorKind
    message: str
    stage: str


class Proposal(_Immutable):
    targetPath: str
    diffUnified: str
    language: str


# --- Blocchi del Corpo del Report (Polimorfismo) ---
class TextBlock(_Immutable):
    kind: Literal["text"] = "text"
    order: int
    markdown: str


class FindingBlock(_Immutable):
    kind: Literal["finding"] = "finding"
    order: int
    owaspCategory: str
    severity: Severity
    filePath: str
    startLine: int
    endLine: int
    explanation: str
    remediation: str


class PolicyViolationBlock(_Immutable):
    kind: Literal["policy_violation"] = "policy_violation"
    order: int
    ruleId: str
    ruleText: str
    filePath: str
    explanation: str


class ChangelogItemBlock(_Immutable):
    kind: Literal["changelog_item"] = "changelog_item"
    order: int
    issueRef: str
    title: str
    detail: str


# Unione discriminata per istanziare automaticamente la sottoclasse corretta in base al campo "kind"
Block = Annotated[
    Union[TextBlock, FindingBlock, PolicyViolationBlock, ChangelogItemBlock],
    Field(discriminator="kind")
]


# --- Envelope Principale ---
class Report(BaseModel):
    id: Optional[str] = None
    taskId: str
    agentId: str
    operation: OperationCode
    status: ReportStatus = "COMPLETED"
    generatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    durationMs: int = 0
    tokensConsumed: int = 0
    summary: str = ""
    error: Optional[ReportError] = None
    body: List[Block] = Field(default_factory=list)
    proposal: Optional[Proposal] = None

    # -- Serializzazione
    def to_dict(self) -> dict:
        return self.model_dump(mode="json")

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)