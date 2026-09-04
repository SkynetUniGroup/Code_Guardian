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
