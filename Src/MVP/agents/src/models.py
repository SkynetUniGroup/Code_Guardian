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

Block = Annotated[
    Union[
        TextBlock,
        FindingBlock,
        PolicyViolationBlock,
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
