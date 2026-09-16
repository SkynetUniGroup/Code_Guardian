"""Security Agent -- SECURITY_OWASP and SECURITY_POLICY operations.

Analyzes code for OWASP Top 10 vulnerabilities and policy violations.
For SECURITY_OWASP the search is in two phases: first Semgrep (deterministic,
high recall), then the LLM that judges each candidate and looks for what a
static rule cannot see.
"""

import logging
from typing import Any

from ..config import settings
from ..github_toolset import GitHubToolset
from ..models import (
    SEVERITY_ORDER,
    Block,
    FindingBlock,
    PolicyViolationBlock,
    Proposal,
    SastFindingBlock,
    SastSummaryBlock,
)
from ..sast_analyzer import SASTAnalyzer
from ._base import extract_json, load_prompt_template, render_prompt

logger = logging.getLogger(__name__)

# Extensions for which a Semgrep ruleset exists in sast_analyzer: keeping
# them aligned avoids downloading files that no rule would then inspect.
_SUPPORTED_EXTS = (".ts", ".js", ".jsx", ".tsx", ".py", ".java", ".go", ".rb")



def _normalize_path(path: str) -> str:
    """Reduces a path to the form used for comparison.

    The model happily rewrites the same file as './src/a.js',
    'src\a.js' or with a leading slash: they are the same file, and
    discarding them as out of scope would be a false negative.
    """
    return path.replace("\\", "/").lstrip("./").lstrip("/")


def _only_in_scope(blocks: list[FindingBlock], ctx: dict | None) -> list[FindingBlock]:
    """Discards findings on files that were not in the requested scope (RF.30).

    The model receives the list of files to examine, but nothing prevents it
    from reporting vulnerabilities on paths it was never given: files
    excluded from the scope, or invented out of thin air. Reporting them
    would mean attributing to the user findings on code they did not ask to
    analyze and that the agent has not read.

    Without 'scope_files' in the context -- a caller passing an empty ctx --
    there is nothing to compare against and the blocks pass through unchanged.
    """
    scope = (ctx or {}).get("scope_files")
    if not scope:
        return blocks

    allowed = {_normalize_path(p) for p in scope}
    return [b for b in blocks if _normalize_path(b.filePath) in allowed]


def _most_critical_first(blocks: list[FindingBlock]) -> list[FindingBlock]:
    """Reorders findings from most to least critical (RF.61).

    The sort is stable: at equal severity the order in which the model
    produced them is preserved, which is the only secondary criterion
    available. A severity not present in SEVERITY_ORDER ends up at the
    bottom instead of causing the sort to fail.
    """
    return sorted(
        blocks,
        key=lambda b: SEVERITY_ORDER.index(b.severity) if b.severity in SEVERITY_ORDER else -1,
        reverse=True,
    )


def _renumbered(blocks: list[FindingBlock], start: int = 0) -> list[FindingBlock]:
    """Renumbers 'order' after filtering and reordering.

    'order' is the position with which the block is rendered on screen:
    leaving it at the arrival value after discarding or moving findings
    would produce gaps and numbering inconsistent with the actual order.
    """
    return [b.model_copy(update={"order": start + i}) for i, b in enumerate(blocks)]


class ContextResourceMissingError(Exception):
    """Specific exception mapped to ErrorKind.CONTEXT_RESOURCE_MISSING."""

    def __init__(self, message: str):
        """Initializes the exception.

        Args:
            message (str): The error message.
        """
        self.error_type = "CONTEXT_RESOURCE_MISSING"
        super().__init__(message)


class ContextResourceInvalidError(Exception):
    """Specific exception mapped to ErrorKind.CONTEXT_RESOURCE_INVALID."""

    def __init__(self, message: str):
        """Initializes the exception.

        Args:
            message (str): The error message.
        """
        self.error_type = "CONTEXT_RESOURCE_INVALID"
        super().__init__(message)


class SecurityLoader
:
    """Loads the context (code and policy) via the Facade."""

    def __init__(
        self, operation: str = "SECURITY_OWASP", sast_analyzer: SASTAnalyzer | None = None
    ):
        """Initializes the loader.

        Args:
            operation (str): The operation code. Defaults to 'SECURITY_OWASP'.
            sast_analyzer (SASTAnalyzer | None): Static analyzer to use before
                the LLM. Injected rather than constructed here so it can be
                replaced in tests and to leave main.py the sole decision on
                whether the feature is active.
        """
        self.operation = operation
        self._sast = sast_analyzer

    async def load(
        self,
        context_ref: Any,
        toolset: GitHubToolset,
        agent_payload: dict | None = None,
    ) -> dict:
        """Loads the security context by resolving the file tree and policy.

        Args:
            context_ref (Any): The context reference with repository details.
            toolset (GitHubToolset): The toolset to interact with GitHub.
            agent_payload (dict, optional): The payload from the agent. Defaults to None.

        Returns:
            dict: The loaded context containing policy and files.

        Raises:
            ContextResourceInvalidError: If no supported files are found in the scope.
            ContextResourceMissingError: If POLICY.md is missing during a POLICY_SCAN.
        """
        owner = context_ref.repoOwner
        repo = context_ref.repoName
        sha = context_ref.resolvedSha
        scope_type = getattr(context_ref, "scopeType", "FULL_REPOSITORY")
        paths = getattr(context_ref, "paths", [])

        tree_response = await toolset.read_tree(owner, repo, sha)
        nodes = tree_response.get("nodes", [])

        files_to_scan = []

        for n in nodes:
            if n["type"] == "file" and n["path"].endswith(_SUPPORTED_EXTS):
                if scope_type == "FULL_REPOSITORY":
                  
  files_to_scan.append(n["path"])
                else:
                    if any(n["path"].startswith(p) for p in paths):
                        files_to_scan.append(n["path"])

        if not files_to_scan:
            raise ContextResourceInvalidError(
                "No source files found for the security scan in the selected scope."
            )

        tree_str = (
            "Supported files available in the requested scope "
            "(use the read_file tool to inspect them):\n"
        )
        tree_str += "\n".join(f"- {f}" for f in files_to_scan)

        policy_node = next((n for n in nodes if n["path"].lower() == "policy.md"), None)

        if policy_node is None and self.operation == "SECURITY_POLICY":
            raise ContextResourceMissingError(
                "POLICY.md not found in the repository: cannot execute Policy Scan without "
                "explicit directives."
            )

        policy_content = "No specific policy provided. Apply standard OWASP rules."
        if policy_node:
            p_resp = await toolset.read_file(owner, repo, sha, policy_node["path"])
            policy_content = p_resp.get("content", policy_content)

        sast_findings, sast_summary, sast_section = await self._run_sast(
            toolset, owner, repo, sha, files_to_scan
        )

        await toolset.report_progress(stage="security_context_loaded", percent=30)

        return {
            "policy": policy_content,
            "files": tree_str,
            # Duplicates the list that tree_str already renders in readable form
            # for the prompt: this is used by parse_output to discard
            # findings on paths outside the requested scope (RF.30).
            "scope_files": files_to_scan,
            "sast_section": sast_section,
            "sast_findings": sast_findings,
            "sast_summary": sast_summary,
        }

    async def _run_sast(
        self,
        toolset: GitHubToolset,
        owner: str,
        re
po: str,
        sha: str,
        files_to_scan: list[str],
    ) -> tuple[list[SastFindingBlock], SastSummaryBlock | None, str]:
        """Runs the static scan, if applicable for this operation.

        Only for SECURITY_OWASP: SECURITY_POLICY checks the rules written in
        the repository's POLICY.md, which no generic ruleset knows.

        Args:
            toolset (GitHubToolset): Facade towards the backend.
            owner (str): Repository owner.
            repo (str): Repository name.
            sha (str): The commit the context is anchored to.
            files_to_scan (list[str]): Paths of the files in scope.

        Returns:
            tuple: The findings, the summary (None if the engine was not
            executable) and the prompt section to submit to the LLM.
        """
        if not (self._sast and self.operation == "SECURITY_OWASP"):
            return [], None, ""

        # Each file is an HTTP round-trip to the facade: without a cap, on a
        # large repository the collection alone would exhaust the operation
        # budget before even querying the model.
        selected = files_to_scan[: settings.sast_max_files]
        if len(files_to_scan) > len(selected):
            logger.warning(
                "SAST limited to first %d files out of %d (SAST_MAX_FILES)",
                len(selected),
                len(files_to_scan),
            )

        file_contents: dict[str, str] = {}
        for path in selected:
            try:
                resp = await toolset.read_file(owner, repo, sha, path)
            except Exception as exc:  # noqa: BLE001 - an unreadable file does not stop the scan
                logger.warning("SAST: unable to read %s (%s)", path, exc)
                continue
            content = resp.get("content", "")
            if content:
                file_contents[path] = content

        findings, summary = await self._sast.analyze(file_contents)
        if summa
ry is None:
            # Engine not available: no SAST section, neither in the prompt nor
            # in the report. A zero summary would read as "no vulnerabilities"
            # instead of "analysis not performed".
            return [], None, ""

        logger.info(
            "SAST completed: %d findings (excluded=%d, timedOut=%s)",
            summary.totalFindings,
            summary.cappedFindings,
            summary.timedOut,
        )
        return findings, summary, self._sast.format_for_prompt(findings, summary)


class OwaspScanProfile:
    """Handles prompt generation and output parsing for the OWASP scan."""

    agent = "security"
    operation = "SECURITY_OWASP"
    max_tool_rounds = settings.max_tool_rounds
    uses_tools = True

    def build_prompt(self, ctx: dict) -> tuple[str, str]:
        """Builds the system and user prompts.

        Args:
            ctx (dict): The context containing the policy and file tree.

        Returns:
            Tuple[str, str]: The generated prompts.
        """
        template_data = load_prompt_template("security", "owasp_scan")
        # 'sast' is a standalone variable, not a prepend to 'files':
        # the template places it where needed and, most importantly, tells
        # the model that this section must be judged (sast_verdicts) not
        # just read. Empty when the scan was not performed.
        return render_prompt(
            template_data,
            policy=ctx["policy"],
            files=ctx["files"],
            sast=ctx.get("sast_section", ""),
        )

    def parse_output(
        self, raw: str, ctx: dict | None = None
    ) -> tuple[list[Block], Proposal | None]:
        """Interprets the model output.

        Produces three groups of blocks: the Semgrep findings with the verdict
        the model gave each one, the updated scan summary, and the findings
        the model found on its own.

        Args:
            raw (str): The raw string output from the model.
            ctx (dict, optional): The loaded context, from which the SAST
                findings produced before the invocation are retrieved.

        Returns:
            Tuple[List[Block], Optional[Proposal]]: The parsed blocks and an optional proposal.
        """
        data = extract_json(raw)
        ctx = ctx or {}
        blocks: list[Block] = self._apply_sast_verdicts(data, ctx)
        order_offset = len(blocks)
        # The model's findings are collected separately: scope filtering and
        # severity reordering apply only to them, while the SAST blocks
        # stay at the front with the numbering they already have.
        found: list[FindingBlock] = []

        for order, item in enumerate(data.get("findings", [])):
            rem_data = item.get("remediation", {})

            if isinstance(rem_data, dict):
                rem_kind = rem_data.get("kind", "").upper()
                if rem_kind == "SNIPPET":
                    remediation = {
                        "kind": "SNIPPET",
                        "language": rem_data.get("language", ""),
                        "code": rem_data.get("code", ""),
                    }
                else:
                    text_fallback = rem_data.get("text", "No remediation provided")
                    remediation = {
                        "kind": "TEXT",
                        "text": rem_data.get("markdown", text_fallback),
                    }
            else:
                remediation = {"kind": "TEXT", "text": str(rem_data)}

            # INFO is no longer downgraded to LOW: the shared Severity domain
            # includes it (shared/src/types.ts), and flattening it would
            # erase the distinction between "informational" and "minor issue".
            raw_severity = str(item.get("severity", "MEDIUM")).upper()

            end_line = item.get("end_line")

            found.append(
                FindingBlock(
          
          order=order_offset + order,
                    category=str(item.get("category", "Uncategorized")),
                    severity=raw_severity,
                    filePath=str(item.get("file", "unknown")),
                    lineStart=int(item.get("start_line", 1)),
                    lineEnd=int(end_line) if end_line else None,
                    description=str(item.get("message", "")),
                    remediation=remediation,
                )
            )

        found = _only_in_scope(found, ctx)
        found = _most_critical_first(found)
        return blocks + _renumbered(found, order_offset), None

    @staticmethod
    def _apply_sast_verdicts(data: dict, ctx: dict) -> list[Block]:
        """Applies the model's verdict to the Semgrep findings.

        The model responds with a `sast_verdicts` array, each referring to a
        finding by `rule_id` **and** position. The rule_id alone is not
        enough: the same rule can be violated in multiple places, and
        matching by rule would assign to all occurrences the verdict given
        to just one. A finding the model does not name stays NEEDS_REVIEW,
        which is the honest answer: nobody looked at it.

        Args:
            data (dict): The model output, already decoded.
            ctx (dict): The loaded context, with the SAST findings and summary.

        Returns:
            list[Block]: The updated SAST findings plus the summary.
        """
        findings: list[SastFindingBlock] = ctx.get("sast_findings") or []
        summary: SastSummaryBlock | None = ctx.get("sast_summary")
        if not findings or summary is None:
            return []

        by_key: dict[tuple[str, str, int], tuple[str, str | None]] = {}
        by_rule: dict[str, tuple[str, str | None]] = {}
        for item in data.get("sast_verdicts", []):
            rule_id = str(item.get("rule_id", ""))
            if not rule_id:
                continue
    
        verdict = str(item.get("verdict", "NEEDS_REVIEW")).upper()
            if verdict not in ("CONFIRMED", "FALSE_POSITIVE", "NEEDS_REVIEW"):
                verdict = "NEEDS_REVIEW"
            remediation = item.get("remediation")
            remediation = str(remediation) if remediation else None

            file_path = str(item.get("file", "") or item.get("file_path", ""))
            line = item.get("line")
            if file_path and line is not None:
                try:
                    by_key[(rule_id, file_path, int(line))] = (verdict, remediation)
                except (TypeError, ValueError):
                    pass
            # Fallback for when the model reports only the rule: applies
            # only if that rule appears exactly once.
            by_rule.setdefault(rule_id, (verdict, remediation))

        rule_counts: dict[str, int] = {}
        for finding in findings:
            rule_counts[finding.ruleId] = rule_counts.get(finding.ruleId, 0) + 1

        blocks: list[Block] = []
        for position, finding in enumerate(findings):
            key = (finding.ruleId, finding.filePath, finding.lineStart)
            match = by_key.get(key)
            if match is None and rule_counts[finding.ruleId] == 1:
                match = by_rule.get(finding.ruleId)
            if match is not None:
                finding.verdict, remediation = match  # type: ignore[assignment]
                if remediation:
                    finding.llmRemediation = remediation
            # Position 0 is for the summary, which is prepended below.
            finding.order = position + 1
            blocks.append(finding)

        updated = summary.model_copy(
            update={
                "order": 0,
                "confirmedFindings": sum(1 for f in findings if f.verdict == "CONFIRMED"),
                "falsePositives": sum(1 for f in findings if f.verdict == "FALSE_POSITIVE"),
                "needsReview": sum(1 for f in 
findings if f.verdict == "NEEDS_REVIEW"),
            }
        )
        # The summary goes at the top of the report: it is the block that says
        # whether the list that follows is complete.
        return [updated, *blocks]


class SecurityPolicyProfile:
    """Handles prompt generation and output parsing for the Policy-as-Code scan."""

    agent = "security"
    operation = "SECURITY_POLICY"
    max_tool_rounds = settings.max_tool_rounds
    uses_tools = True

    def build_prompt(self, ctx: dict) -> tuple[str, str]:
        """Builds the system and user prompts.

        Args:
            ctx (dict): The context containing the policy and file tree.

        Returns:
            Tuple[str, str]: The generated prompts.
        """
        template_data = load_prompt_template("security", "policy_scan")
        return render_prompt(template_data, policy=ctx["policy"], files=ctx["files"])

    def parse_output(
        self, raw: str, ctx: dict | None = None
    ) -> tuple[list[Block], Proposal | None]:
        """Parses the raw output into PolicyViolationBlocks.

        Args:
            raw (str): The raw string output from the model.
            ctx (dict, optional): The context containing additional information.

        Returns:
            Tuple[List[Block], Optional[Proposal]]: The parsed blocks and an optional proposal.
        """
        data = extract_json(raw)
        blocks: list[Block] = []

        for order, item in enumerate(data.get("findings", [])):
            rem_data = item.get("remediation", {})

            if isinstance(rem_data, dict):
                rem_kind = rem_data.get("kind", "").upper()
                if rem_kind == "SNIPPET":
                    remediation = {
                        "kind": "SNIPPET",
                        "language": rem_data.get("language", ""),
                        "code": rem_data.get("code", ""),
                    }
                else:
                    text_fallback = rem_data.get("text", "No remediation pr
ovided")
                    remediation = {
                        "kind": "TEXT",
                        "text": rem_data.get("markdown", text_fallback),
                    }
            else:
                remediation = {"kind": "TEXT", "text": str(rem_data)}

            start_line = item.get("start_line")
            end_line = item.get("end_line")

            blocks.append(
                PolicyViolationBlock(
                    order=order,
                    ruleId=str(item.get("ruleId", "unknown")),
                    ruleText=str(item.get("ruleText", "")),
                    filePath=str(item.get("filePath", "unknown")),
                    lineStart=int(start_line) if start_line else None,
                    lineEnd=int(end_line) if end_line else None,
                    severity=str(item.get("severity", "MEDIUM")).upper(),
                    explanation=str(item.get("explanation", "")),
                    remediation=remediation,
                )
            )
        return blocks, None


