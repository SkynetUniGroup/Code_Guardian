<<<<<<< HEAD
from __future__ import annotations

from typing import Annotated, Literal, Optional, Union
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Base blocks
# ---------------------------------------------------------------------------

class TextBlock(BaseModel):
    kind: Literal["TEXT"] = "TEXT"
    content: str


class FindingBlock(BaseModel):
    kind: Literal["FINDING"] = "FINDING"
    severity: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
    title: str
    description: str
    file_path: Optional[str] = None
    line: Optional[int] = None
    rule_id: Optional[str] = None
    remediation: Optional[str] = None


class PolicyViolationBlock(BaseModel):
    kind: Literal["POLICY_VIOLATION"] = "POLICY_VIOLATION"
    policy: str
    description: str
    file_path: Optional[str] = None
    remediation: Optional[str] = None


class ChangelogItemBlock(BaseModel):
    kind: Literal["CHANGELOG_ITEM"] = "CHANGELOG_ITEM"
    entry_type: Literal["Added", "Changed", "Fixed", "Removed", "Security", "Deprecated"]
    description: str


# ---------------------------------------------------------------------------
# SAST blocks
# ---------------------------------------------------------------------------

class SASTFindingBlock(BaseModel):
    kind: Literal["SAST_FINDING"] = "SAST_FINDING"
    rule_id: str
    owasp_category: str
    severity: Literal["ERROR", "WARNING", "INFO"]
    file_path: str
    line: int
    message: str
    code_snippet: Optional[str] = None
    cwe: Optional[str] = None
    llm_verdict: Literal["CONFIRMED", "FALSE_POSITIVE", "NEEDS_REVIEW"] = "NEEDS_REVIEW"
    llm_remediation: Optional[str] = None


class SASTSummary(BaseModel):
    kind: Literal["SAST_SUMMARY"] = "SAST_SUMMARY"
    total_findings: int
    confirmed_findings: int
    false_positives: int
    needs_review: int
    capped_findings: int
    scanned_files: int
    duration_ms: int
    timed_out: bool


# ---------------------------------------------------------------------------
# Complexity block
# ---------------------------------------------------------------------------

class ComplexityWarningBlock(BaseModel):
    kind: Literal["COMPLEXITY_WARNING"] = "COMPLEXITY_WARNING"
    file_path: str
    function_name: str
    cyclomatic_complexity: int
    threshold: int
    suggestion: str


# ---------------------------------------------------------------------------
# Discriminated union
# ---------------------------------------------------------------------------
=======
"""Shared data contract (Report Envelope).

Exactly reflects the class diagram (Figure 4) of the specifications.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Any, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

# --- Shared Types and Enumerations ---

OperationCode = Literal[
    "DOCS_README",
    "DOCS_INLINE",
    "DOCS_API",
    "SECURITY_OWASP",
    "SECURITY_POLICY",
    "CHANGELOG_TECHNICAL",
    "CHANGELOG_BUSINESS",
]

ReportStatus = Literal["COMPLETED", "FAILED"]

Severity = Literal["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]
SEVERITY_ORDER: tuple[str, ...] = ("INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL")


class ErrorKind(str, Enum):
    """Enumeration of possible error kinds."""

    TIMEOUT = "TIMEOUT"
    PARSING = "PARSING"
    UPSTREAM = "UPSTREAM"
    CONTEXT_TOO_LARGE = "CONTEXT_TOO_LARGE"
    CONTEXT_RESOURCE_MISSING = "CONTEXT_RESOURCE_MISSING"
    CONTEXT_RESOURCE_INVALID = "CONTEXT_RESOURCE_INVALID"
    READABILITY_TOO_LOW = "READABILITY_TOO_LOW"
    RATE_LIMITED = "RATE_LIMITED"


class _Immutable(BaseModel):
    """Base class for immutable models."""

    model_config = ConfigDict(frozen=True)


# --- Error and Proposal ---


class ReportError(_Immutable):
    """Represents an error within the report."""

    kind: ErrorKind
    message: str
    stage: str


class Proposal(_Immutable):
    """Represents a proposed change in the repository."""

    targetPath: str
    diffUnified: str
    language: str
    pullRequestUrl: Optional[str] = None


# --- Report Body Blocks (Polymorphism) ---


class TextBlock(_Immutable):
    """Represents a standard text block."""

    kind: Literal["TEXT"] = "TEXT"
    order: int
    markdown: str


class RemediationSnippet(_Immutable):
    """Represents a code snippet for remediation."""

    kind: Literal["SNIPPET"] = "SNIPPET"
    language: str
    code: str


class RemediationText(_Immutable):
    """Represents a textual description for remediation."""

    kind: Literal["TEXT"] = "TEXT"
    text: str


Remediation = Annotated[
    Union[RemediationSnippet, RemediationText], Field(discriminator="kind")
]


class FindingBlock(_Immutable):
    """Represents a security finding block."""

    kind: Literal["FINDING"] = "FINDING"
    order: int
    category: str
    severity: Severity
    filePath: str
    lineStart: int
    lineEnd: Optional[int] = None
    description: str
    remediation: Remediation


class PolicyViolationBlock(_Immutable):
    """Represents a policy violation block."""

    kind: Literal["POLICY_VIOLATION"] = "POLICY_VIOLATION"
    order: int
    ruleId: str
    ruleText: str
    filePath: str
    lineStart: Optional[int] = None
    lineEnd: Optional[int] = None
    severity: Severity
    explanation: str
    remediation: Remediation


class ComplexityWarningBlock(_Immutable):
    """Represents an excessive complexity warning block."""

    kind: Literal["COMPLEXITY_WARNING"] = "COMPLEXITY_WARNING"
    category: Literal["EXCESSIVE_COMPLEXITY"] = "EXCESSIVE_COMPLEXITY"
    order: int
    severity: Severity = "INFO"  # Fixed value, not generated by LLM
    filePath: str
    lineStart: int
    lineEnd: int
    reason: str


class ChangelogItemBlock(_Immutable):
    """Represents a changelog item block."""

    kind: Literal["CHANGELOG_ITEM"] = "CHANGELOG_ITEM"
    order: int
    issueRef: str
    title: str
    detail: str

>>>>>>> origin/develop

Block = Annotated[
    Union[
        TextBlock,
        FindingBlock,
        PolicyViolationBlock,
<<<<<<< HEAD
        ChangelogItemBlock,
        SASTFindingBlock,
        SASTSummary,
        ComplexityWarningBlock,
    ],
    Field(discriminator="kind"),
]


# ---------------------------------------------------------------------------
# Proposal (docs unified diff)
# ---------------------------------------------------------------------------

class Proposal(BaseModel):
    task_id: str
    agent_type: str
    unified_diff: str
    model: str
    usage: dict = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

class Report(BaseModel):
    task_id: str
    agent_type: str
    blocks: list[Block]
    model: str
    usage: dict = Field(default_factory=dict)
    proposal: Optional[Proposal] = None


class ReportError(BaseModel):
    task_id: str
    agent_type: str
    error_kind: Literal["TIMEOUT", "PARSING", "UPSTREAM"]
    message: str


# ---------------------------------------------------------------------------
# Agent run request
# ---------------------------------------------------------------------------

class AgentRunRequest(BaseModel):
    task_id: str
    repo_owner: str
    repo_name: str
    commit_sha: str
    pr_number: Optional[int] = None
    changed_files: list[str] = Field(default_factory=list)
    # Optional integration credentials (encrypted by backend, decrypted here)
    sonarqube_credentials: Optional[dict] = None
=======
        ComplexityWarningBlock,
        ChangelogItemBlock,
    ],
    Field(discriminator="kind"),
]


class ReportContext(BaseModel):
    """Denormalized snapshot of the context at the time of the Report."""

    repoOwner: str
    repoName: str
    repoUrl: str
    branch: str
    resolvedSha: str
    scopeType: str
    paths: List[str] = Field(default_factory=list)


class PendingAction(BaseModel):
    """Read-only projection of Task.pendingInput for the frontend."""

    kind: Literal["BUSINESS_CONFIRMATION"]
    taskId: str
    actions: List[Literal["PROCEED", "CANCEL"]]


# --- Main Envelope ---


class Report(BaseModel):
    """The main envelope representing the output report."""

    id: Optional[str] = None
    taskId: str
    agentId: str
    operation: OperationCode
    status: ReportStatus = "COMPLETED"
    # NOTE: According to MVP specs, the title is composed deterministically
    # by the NestJS backend. The agent defaults this to an empty string.
    title: str = ""
    summary: Optional[str] = None
    generatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    executionTimeMs: Optional[int] = None
    tokensConsumed: int = 0
    context: ReportContext
    error: Optional[ReportError] = None
    body: List[Block] = Field(default_factory=list)
    proposal: Optional[Proposal] = None
    pendingAction: Optional[PendingAction] = None

    def to_dict(self) -> dict:
        """Serializes the report to a dictionary.

        Returns:
            dict: The serialized report.
        """
        return self.model_dump(mode="json")

    def to_json(self, indent: int = 2) -> str:
        """Serializes the report to a JSON string.

        Args:
            indent (int, optional): Indentation level. Defaults to 2.

        Returns:
            str: The JSON string representation of the report.
        """
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)


# --- Pause/Resume Mechanism Payloads ---


class PendingInputSprintId(BaseModel):
    """Pending input for the Sprint ID request."""

    kind: Literal["SPRINT_ID"]


class PendingInputIncompleteTasks(BaseModel):
    """Pending input for excluding tasks with insufficient metadata."""

    kind: Literal["INCOMPLETE_TASKS"]
    taskIds: List[str]


class PendingInputBusinessConfirmation(BaseModel):
    """Pending input for the business changelog confirmation."""

    kind: Literal["BUSINESS_CONFIRMATION"]
    # Left intentionally Optional: Python does not generate it,
    # NestJS will populate it after persisting the report to MongoDB.
    technicalReportId: Optional[str] = None


PendingInput = Annotated[
    Union[
        PendingInputSprintId,
        PendingInputIncompleteTasks,
        PendingInputBusinessConfirmation,
    ],
    Field(discriminator="kind"),
]


class AgentStepResult(BaseModel):
    """Represents the result of an agent step execution."""

    status: Literal["interrupted", "completed", "failed"]
    pendingInput: Optional[PendingInput] = None
    result: Optional[dict] = None
    error: Optional[str] = None


class StartAgentRequest(BaseModel):
    """Represents a request to start an agent."""

    taskId: str
    threadId: str
    operationCode: str
    payload: dict


class ResumeAgentRequest(BaseModel):
    """Represents a request to resume an agent."""

    taskId: str
    userId: str
    threadId: str
    operationCode: str
    inputValue: Any
>>>>>>> origin/develop
