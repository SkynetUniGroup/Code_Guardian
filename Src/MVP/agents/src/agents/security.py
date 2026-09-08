<<<<<<< HEAD
from __future__ import annotations

import logging
from typing import Any, Optional

from ..config import settings
from ..github_toolset import GitHubToolset
from ..models import Block, FindingBlock, PolicyViolationBlock, Proposal, SASTFindingBlock, SASTSummary
from ..sast_analyzer import SASTAnalyzer
from ._base import extract_json, load_prompt_template, render_prompt

logger = logging.getLogger(__name__)

_SUPPORTED_EXTS = (".ts", ".js", ".py", ".java", ".go", ".rb")


class SecurityLoader:
    def __init__(self, operation: str = "SECURITY_OWASP", sast_analyzer: Optional[SASTAnalyzer] = None):
        self.operation = operation
        self._sast = sast_analyzer

    async def load(self, context_ref: Any, toolset: GitHubToolset) -> dict:
        owner = context_ref.repoOwner
        repo = context_ref.repoName
        sha = context_ref.ref
        scope_type = getattr(context_ref, "scopeType", "FULL_REPOSITORY")
        paths = getattr(context_ref, "paths", [])

        tree_response = await toolset.read_tree(owner, repo, sha)
        nodes = tree_response.get("nodes", [])

        files_to_scan = [
            n["path"]
            for n in nodes
            if n["type"] == "file" and n["path"].endswith(_SUPPORTED_EXTS)
            and (scope_type == "FULL_REPOSITORY" or any(n["path"].startswith(p) for p in paths))
        ]

        if not files_to_scan:
            raise ValueError("Nessun file sorgente trovato per la scansione di sicurezza.")

        policy_node = next((n for n in nodes if n["path"].lower() == "policy.md"), None)
        if policy_node is None and self.operation == "SECURITY_POLICY":
            raise ValueError("POLICY.md non trovato — impossibile eseguire la Policy Scan.")

        policy_content = "Nessuna policy specifica. Applica regole OWASP standard."
        if policy_node:
            p_resp = await toolset.read_file(owner, repo, sha, policy_node["path"])
            policy_content = p_resp.get("content", policy_content)

        # Phase 1: SAST static scan
        sast_findings: list[SASTFindingBlock] = []
        sast_summary: Optional[SASTSummary] = None
        sast_section = ""

        if settings.enable_sast_semgrep and self.operation == "SECURITY_OWASP":
            file_contents: dict[str, str] = {}
            for path in files_to_scan:
                resp = await toolset.read_file(owner, repo, sha, path)
                content = resp.get("content", "")
                if content:
                    file_contents[path] = content

            sast_findings, sast_summary = await self._sast.analyze(file_contents)
            sast_section = self._sast.format_for_prompt(sast_findings, sast_summary)
            logger.info(
                "SAST completato: %d findings (capped=%d, timedOut=%s)",
                sast_summary.total_findings,
                sast_summary.capped_findings,
                sast_summary.timed_out,
            )
        else:
            file_contents = {}

        tree_str = "File disponibili per l'ispezione (usa il tool read_file):\n"
        tree_str += "\n".join(f"- {f}" for f in files_to_scan)

        await toolset.report_progress(stage="security_context_loaded", percent=30)

        return {
            "policy": policy_content,
            "files": tree_str,
            "sast_section": sast_section,
            "sast_findings": sast_findings,
            "sast_summary": sast_summary,
        }


class SecurityProfile:
    agent = "security"
    max_tool_rounds = 20

    def __init__(self, operation: str = "SECURITY_OWASP"):
        self.operation = operation
        self._ctx: dict = {}

    def build_prompt(self, ctx: dict) -> tuple[str, str]:
        self._ctx = ctx
        template_id = "owasp_scan" if self.operation == "SECURITY_OWASP" else "policy_scan"
        template_data = load_prompt_template("security", template_id)

        files_section = ctx["files"]
        if ctx.get("sast_section"):
            files_section = ctx["sast_section"] + "\n\n" + files_section

        return render_prompt(template_data, policy=ctx["policy"], files=files_section)

    def parse_output(self, raw: str) -> tuple[list[Block], Optional[Proposal]]:
        data = extract_json(raw)
        blocks: list[Block] = []

        sast_findings: list[SASTFindingBlock] = self._ctx.get("sast_findings", [])
        sast_summary: Optional[SASTSummary] = self._ctx.get("sast_summary")

        llm_verdicts: dict[str, tuple[str, Optional[str]]] = {}
        for item in data.get("sast_verdicts", []):
            rule_id = item.get("rule_id", "")
            verdict = item.get("verdict", "NEEDS_REVIEW")
            remediation = item.get("remediation")
            if rule_id:
                llm_verdicts[rule_id] = (verdict, remediation)

        for finding in sast_findings:
            verdict, remediation = llm_verdicts.get(finding.rule_id, ("NEEDS_REVIEW", None))
            if verdict in ("CONFIRMED", "FALSE_POSITIVE", "NEEDS_REVIEW"):
                finding.llm_verdict = verdict  # type: ignore[assignment]
            if remediation:
                finding.llm_remediation = remediation
            blocks.append(finding)

        if sast_summary:
            confirmed = sum(1 for f in sast_findings if f.llm_verdict == "CONFIRMED")
            false_pos = sum(1 for f in sast_findings if f.llm_verdict == "FALSE_POSITIVE")
            needs = sum(1 for f in sast_findings if f.llm_verdict == "NEEDS_REVIEW")
            updated_summary = SASTSummary(
                total_findings=sast_summary.total_findings,
                confirmed_findings=confirmed,
                false_positives=false_pos,
                needs_review=needs,
                capped_findings=sast_summary.capped_findings,
                scanned_files=sast_summary.scanned_files,
                duration_ms=sast_summary.duration_ms,
                timed_out=sast_summary.timed_out,
            )
            blocks.append(updated_summary)

        for item in data.get("findings", []):
            if self.operation == "SECURITY_POLICY":
                blocks.append(
                    PolicyViolationBlock(
                        policy=str(item.get("ruleId", "unknown")),
                        description=str(item.get("explanation", "")),
                        file_path=str(item.get("filePath", "unknown")),
                        remediation=str(item.get("remediation", "")) or None,
                    )
                )
            else:
                rem_data = item.get("remediation", {})
                if isinstance(rem_data, dict):
                    remediation_str = (
                        f"```\n{rem_data.get('code', '')}\n```"
                        if rem_data.get("kind") == "snippet"
                        else rem_data.get("markdown", "")
                    )
                else:
                    remediation_str = str(rem_data)

                blocks.append(
                    FindingBlock(
                        severity=item.get("severity", "medium").upper()
                        if item.get("severity", "").upper() in ("CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO")
                        else "MEDIUM",
                        title=str(item.get("category", "Vulnerabilità rilevata")),
                        description=str(item.get("message", "")),
                        file_path=str(item.get("file", "unknown")),
                        line=int(item.get("start_line", 1)),
                        remediation=remediation_str or None,
                    )
                )

        return blocks, None
=======
"""Security Agent -- SECURITY_OWASP operation.

Analyzes the source code looking for OWASP Top 10 vulnerabilities.
"""

from typing import Any, List, Optional, Tuple

from ..config import settings
from ..github_toolset import GitHubToolset
from ..models import Block, FindingBlock, PolicyViolationBlock, Proposal
from ._base import extract_json, load_prompt_template, render_prompt


class ContextResourceMissingError(Exception):
    """Specific exception mapped to ErrorKind.CONTEXT_RESOURCE_MISSING."""

    def __init__(self, message: str):
        """Initializes the exception.

        Args:
            message (str): The error message.
        """
        self.error_type = 'CONTEXT_RESOURCE_MISSING'
        super().__init__(message)


class ContextResourceInvalidError(Exception):
    """Specific exception mapped to ErrorKind.CONTEXT_RESOURCE_INVALID."""

    def __init__(self, message: str):
        """Initializes the exception.

        Args:
            message (str): The error message.
        """
        self.error_type = 'CONTEXT_RESOURCE_INVALID'
        super().__init__(message)


class SecurityLoader:
    """Loads the context (code and policy) via the Facade."""

    def __init__(self, operation: str = 'SECURITY_OWASP'):
        """Initializes the loader.

        Args:
            operation (str): The operation code. Defaults to 'SECURITY_OWASP'.
        """
        self.operation = operation

    async def load(
        self, context_ref: Any, toolset: GitHubToolset, agent_payload: dict = None
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
        scope_type = getattr(context_ref, 'scopeType', 'FULL_REPOSITORY')
        paths = getattr(context_ref, 'paths', [])

        tree_response = await toolset.read_tree(owner, repo, sha)
        nodes = tree_response.get('nodes', [])

        supported_exts = ('.ts', '.js', '.py')
        files_to_scan = []

        for n in nodes:
            if n['type'] == 'file' and n['path'].endswith(supported_exts):
                if scope_type == 'FULL_REPOSITORY':
                    files_to_scan.append(n['path'])
                else:
                    if any(n['path'].startswith(p) for p in paths):
                        files_to_scan.append(n['path'])

        if not files_to_scan:
            raise ContextResourceInvalidError(
                'No source files found for the security scan in the selected scope.'
            )

        tree_str = (
            'Supported files available in the requested scope '
            '(use the read_file tool to inspect them):\n'
        )
        tree_str += '\n'.join(f'- {f}' for f in files_to_scan)

        policy_node = next((n for n in nodes if n['path'].lower() == 'policy.md'), None)

        if policy_node is None and self.operation == 'SECURITY_POLICY':
            raise ContextResourceMissingError(
                'POLICY.md not found in the repository: cannot execute Policy Scan without '
                'explicit directives.'
            )

        policy_content = 'No specific policy provided. Apply standard OWASP rules.'
        if policy_node:
            p_resp = await toolset.read_file(owner, repo, sha, policy_node['path'])
            policy_content = p_resp.get('content', policy_content)

        await toolset.report_progress(stage='security_context_loaded', percent=30)

        return {
            'policy': policy_content,
            'files': tree_str
        }


class OwaspScanProfile:
    """Handles prompt generation and output parsing for the OWASP scan."""

    agent = 'security'
    operation = 'SECURITY_OWASP'
    max_tool_rounds = settings.max_tool_rounds
    uses_tools = True

    def build_prompt(self, ctx: dict) -> Tuple[str, str]:
        """Builds the system and user prompts.

        Args:
            ctx (dict): The context containing the policy and file tree.

        Returns:
            Tuple[str, str]: The generated prompts.
        """
        template_data = load_prompt_template('security', 'owasp_scan')
        return render_prompt(
            template_data,
            policy=ctx['policy'],
            files=ctx['files']
        )

    def parse_output(self, raw: str, ctx: dict = None) -> Tuple[List[Block], Optional[Proposal]]:
        """Parses the raw output into FindingBlocks.

        Args:
            raw (str): The raw string output from the model.
            ctx (dict, optional): The context containing additional information.

        Returns:
            Tuple[List[Block], Optional[Proposal]]: The parsed blocks and an optional proposal.
        """
        data = extract_json(raw)
        blocks: List[Block] = []

        for order, item in enumerate(data.get('findings', [])):
            rem_data = item.get('remediation', {})

            if isinstance(rem_data, dict):
                rem_kind = rem_data.get('kind', '').upper()
                if rem_kind == 'SNIPPET':
                    remediation = {
                        'kind': 'SNIPPET',
                        'language': rem_data.get('language', ''),
                        'code': rem_data.get('code', '')
                    }
                else:
                    text_fallback = rem_data.get('text', 'No remediation provided')
                    remediation = {
                        'kind': 'TEXT',
                        'text': rem_data.get('markdown', text_fallback)
                    }
            else:
                remediation = {'kind': 'TEXT', 'text': str(rem_data)}

            raw_severity = item.get('severity', 'MEDIUM').upper()
            if raw_severity == 'INFO':
                raw_severity = 'LOW'

            end_line = item.get('end_line')

            blocks.append(
                FindingBlock(
                    order=order,
                    category=str(item.get('category', 'Uncategorized')),
                    severity=raw_severity,
                    filePath=str(item.get('file', 'unknown')),
                    lineStart=int(item.get('start_line', 1)),
                    lineEnd=int(end_line) if end_line else None,
                    description=str(item.get('message', '')),
                    remediation=remediation
                )
            )
        return blocks, None


class SecurityPolicyProfile:
    """Handles prompt generation and output parsing for the Policy-as-Code scan."""

    agent = 'security'
    operation = 'SECURITY_POLICY'
    max_tool_rounds = settings.max_tool_rounds
    uses_tools = True

    def build_prompt(self, ctx: dict) -> Tuple[str, str]:
        """Builds the system and user prompts.

        Args:
            ctx (dict): The context containing the policy and file tree.

        Returns:
            Tuple[str, str]: The generated prompts.
        """
        template_data = load_prompt_template('security', 'policy_scan')
        return render_prompt(
            template_data,
            policy=ctx['policy'],
            files=ctx['files']
        )

    def parse_output(self, raw: str, ctx: dict = None) -> Tuple[List[Block], Optional[Proposal]]:
        """Parses the raw output into PolicyViolationBlocks.

        Args:
            raw (str): The raw string output from the model.
            ctx (dict, optional): The context containing additional information.

        Returns:
            Tuple[List[Block], Optional[Proposal]]: The parsed blocks and an optional proposal.
        """
        data = extract_json(raw)
        blocks: List[Block] = []

        for order, item in enumerate(data.get('findings', [])):
            rem_data = item.get('remediation', {})

            if isinstance(rem_data, dict):
                rem_kind = rem_data.get('kind', '').upper()
                if rem_kind == 'SNIPPET':
                    remediation = {
                        'kind': 'SNIPPET',
                        'language': rem_data.get('language', ''),
                        'code': rem_data.get('code', '')
                    }
                else:
                    text_fallback = rem_data.get('text', 'No remediation provided')
                    remediation = {
                        'kind': 'TEXT',
                        'text': rem_data.get('markdown', text_fallback)
                    }
            else:
                remediation = {'kind': 'TEXT', 'text': str(rem_data)}

            start_line = item.get('start_line')
            end_line = item.get('end_line')

            blocks.append(
                PolicyViolationBlock(
                    order=order,
                    ruleId=str(item.get('ruleId', 'unknown')),
                    ruleText=str(item.get('ruleText', '')),
                    filePath=str(item.get('filePath', 'unknown')),
                    lineStart=int(start_line) if start_line else None,
                    lineEnd=int(end_line) if end_line else None,
                    severity=str(item.get('severity', 'MEDIUM')).upper(),
                    explanation=str(item.get('explanation', '')),
                    remediation=remediation
                )
            )
        return blocks, None
>>>>>>> origin/develop
