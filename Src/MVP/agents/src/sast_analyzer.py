"""Static analysis (SAST) with Semgrep.

First phase of the SECURITY_OWASP operation: a deterministic tool finds the
candidates, the LLM judges them one by one (OwaspScanProfile.parse_output).
The point of the combination is that neither suffices alone -- Semgrep has
high recall and many false positives, the model can discard them but cannot
search exhaustively.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from .config import settings
from .models import SEMGREP_SEVERITY_MAP, SastFindingBlock, SastSummaryBlock

logger = logging.getLogger(__name__)

# Priority order in which findings are cut when they exceed the cap:
# ERROR findings reach the model before WARNING, WARNING before INFO.
_SEVERITY_RANK = {"ERROR": 0, "WARNING": 1, "INFO": 2}

_OWASP_RULESETS: list[str] = [
    "p/owasp-top-ten",
]

_LANGUAGE_RULESETS: dict[str, list[str]] = {
    "py": ["p/python"],
    "js": ["p/javascript"],
    "ts": ["p/typescript"],
    "jsx": ["p/javascript"],
    "tsx": ["p/typescript"],
    "java": ["p/java"],
    "go": ["p/golang"],
    "rb": ["p/ruby"],
}

_MAX_SNIPPET_CHARS = 300


class SASTAnalyzer:
    """Runs Semgrep on a set of files and normalizes its results."""

    def __init__(
        self, timeout_s: int | None = None, max_findings: int | None = None
    ) -> None:
        """Initializes the analyzer.

        Args:
            timeout_s (int | None): Cap on the scan time. Default:
                settings.semgrep_timeout_s.
            max_findings (int | None): How many findings to submit to the model.
                Default: settings.sast_max_findings_llm.
        """
        self._timeout_s = timeout_s or settings.semgrep_timeout_s
        self._max_findings = max_findings or settings.sast_max_findings_llm

    async def analyze(
        self, files: dict[str, str]
    ) -> tuple[list[SastFindingBlock], SastSummaryBlock | None]:
        """Analyzes the files and returns the findings with their summary.

        Args:
            files (dict[str, str]): File contents, indexed by path
                relative to the repository root.

        Returns:
            tuple[list[SastFindingBlock], SastSummaryBlock | None]: The findings
            (already deduplicated, sorted by severity and capped) and the
            summary. The summary is **None** when the engine could not be
            executed: in that case the report must not contain any SAST
            section, because a summary with zero findings would read as
            "no vulnerabilities found" rather than "analysis not executed".
        """
        if not files:
            return [], self._empty_summary()

        start_ms = int(time.time() * 1000)
        timed_out = False
        raw_findings: list[dict[str, Any]] = []

        with tempfile.TemporaryDirectory(prefix="cg_sast_") as tmpdir:
            written = self._write_files(tmpdir, files)
            if not written:
                logger.warning("No writable files for SAST scan")
                return [], self._empty_summary()

            extensions = {Path(p).suffix.lstrip(".") for p in written}
            rulesets = self._build_rulesets(extensions)

            try:
                raw_findings = await asyncio.wait_for(
                    self._run_semgrep(tmpdir, rulesets),
                    timeout=self._timeout_s,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "Semgrep exceeded %ds -- proceeding with partial results",
                    self._timeout_s,
                )
                timed_out = True
            except FileNotFoundError:
                # The binary is not installed in the image. It is not a
                # task error: the operation proceeds with the LLM only,
                # which is the behavior that existed before SAST was a thing.
                logger.error(
                    "Binary 'semgrep' not found: static analysis skipped. "
                    "Install it (pip install semgrep) or set ENABLE_SAST_SEMGREP=false."
                )
                return [], None
            except OSError as exc:
                logger.error("Unable to run Semgrep: %s -- static analysis skipped", exc)
                return [], None

            # Parsing is inside the `with`: the result paths are
            # absolute inside tmpdir and must be made relative while the
            # directory still exists.
            findings = self._parse_findings(raw_findings, tmpdir)

        duration_ms = int(time.time() * 1000) - start_ms

        findings = self._sort_by_severity(self._dedup(findings))

        capped = max(0, len(findings) - self._max_findings)
        capped_findings = findings[: self._max_findings]
        for order, finding in enumerate(capped_findings):
            finding.order = order

        summary = SastSummaryBlock(
            totalFindings=len(findings),
            # Verdicts are known only after the LLM pass: here they are
            # all NEEDS_REVIEW, and the summary is recalculated in
            # OwaspScanProfile.parse_output.
            needsReview=len(capped_findings),
            cappedFindings=capped,
            scannedFiles=len(files),
            durationMs=duration_ms,
            timedOut=timed_out,
        )

        return capped_findings, summary

    def _write_files(self, tmpdir: str, files: dict[str, str]) -> list[str]:
        """Materializes the files in a temporary directory.

        Paths come from the tree of a repository we do not control:
        before writing, each path is verified to stay inside tmpdir, so
        that a crafted path (`../../etc/...`, an absolute path) cannot
        make the analyzer write outside its own sandbox. This is the only
        point where this service writes to disk content taken from a
        third-party repository.

        Args:
            tmpdir (str): Destination temporary directory.
            files (dict[str, str]): Content by relative path.

        Returns:
            list[str]: The relative paths actually written.
        """
        root = Path(tmpdir).resolve()
        written: list[str] = []

        for rel_path, content in files.items():
            candidate = (root / rel_path).resolve()
            if not candidate.is_relative_to(root):
                logger.warning("Path outside SAST sandbox, ignored: %s", rel_path)
                continue
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_text(content, encoding="utf-8")
            written.append(rel_path)

        return written

    def _build_rulesets(self, extensions: set[str]) -> list[str]:
        """Composes the rulesets: OWASP always, plus those of the present languages.

        Args:
            extensions (set[str]): Extensions of the files to analyze.

        Returns:
            list[str]: Rulesets without duplicates, in insertion order.
        """
        rulesets = list(_OWASP_RULESETS)
        for ext in extensions:
            rulesets.extend(_LANGUAGE_RULESETS.get(ext, []))
        return list(dict.fromkeys(rulesets))

    async def _run_semgrep(self, target_dir: str, rulesets: list[str]) -> list[dict[str, Any]]:
        """Launches Semgrep as a subprocess and collects its JSON output.

        Args:
            target_dir (str): Directory to analyze.
            rulesets (list[str]): Rulesets to apply.

        Returns:
            list[dict[str, Any]]: The raw results, or an empty list.

        Raises:
            FileNotFoundError: If the semgrep binary is not installed.
        """
        config_args: list[str] = []
        for ruleset in rulesets:
            config_args += ["--config", ruleset]

        cmd = [
            "semgrep",
            *config_args,
            "--json",
            "--no-rewrite-rule-ids",
            "--max-target-bytes",
            "1000000",
            target_dir,
        ]

        logger.debug("Running semgrep: %s", " ".join(cmd))
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await proc.communicate()
        except asyncio.CancelledError:
            # The wait_for timeout cancels this coroutine: without
            # terminating the process, semgrep would remain orphaned
            # consuming CPU for the entire lifetime of the container.
            proc.kill()
            await proc.wait()
            raise

        if stderr:
            logger.debug("semgrep stderr: %s", stderr.decode("utf-8", errors="replace")[:500])

        if not stdout:
            return []

        try:
            data = json.loads(stdout.decode("utf-8"))
            return data.get("results", [])
        except json.JSONDecodeError:
            logger.warning("Uninterpretable semgrep JSON output")
            return []

    def _parse_findings(
        self, raw: list[dict[str, Any]], tmpdir: str
    ) -> list[SastFindingBlock]:
        """Converts raw results into blocks of the shared contract.

        Args:
            raw (list[dict[str, Any]]): Raw Semgrep results.
            tmpdir (str): Scan directory, to make paths relative.

        Returns:
            list[SastFindingBlock]: The interpretable findings; the rest are
            discarded with a log, without failing the entire scan.
        """
        findings: list[SastFindingBlock] = []
        for item in raw:
            try:
                finding = self._map_result(item, tmpdir)
                if finding:
                    findings.append(finding)
            except (KeyError, TypeError, ValueError) as exc:
                logger.debug("Discarded semgrep result: %s", exc)
        return findings

    def _map_result(self, item: dict[str, Any], tmpdir: str) -> SastFindingBlock | None:
        """Maps a single Semgrep result onto the report block.

        Args:
            item (dict[str, Any]): The raw result.
            tmpdir (str): Scan directory.

        Returns:
            SastFindingBlock | None: The corresponding block.
        """
        extra: dict = item.get("extra", {})
        metadata: dict = extra.get("metadata", {})

        raw_severity = str(extra.get("severity") or "WARNING").upper()
        rule_severity = raw_severity if raw_severity in _SEVERITY_RANK else "WARNING"

        owasp_refs = metadata.get("owasp", [])
        if isinstance(owasp_refs, str):
            owasp_refs = [owasp_refs]
        owasp_category = owasp_refs[0] if owasp_refs else "OWASP-UNKNOWN"

        cwe_refs = metadata.get("cwe", [])
        if isinstance(cwe_refs, str):
            cwe_refs = [cwe_refs]
        cwe = cwe_refs[0] if cwe_refs else None

        message: str = str(extra.get("message", "No message")).strip()
        snippet: str = str(extra.get("lines", "")).strip()
        if len(snippet) > _MAX_SNIPPET_CHARS:
            snippet = snippet[: _MAX_SNIPPET_CHARS - 3] + "..."

        return SastFindingBlock(
            ruleId=str(item.get("check_id", "unknown")),
            owaspCategory=str(owasp_category),
            cwe=str(cwe) if cwe else None,
            severity=SEMGREP_SEVERITY_MAP.get(rule_severity, "MEDIUM"),
            ruleSeverity=rule_severity,  # type: ignore[arg-type]
            filePath=self._relative_path(str(item.get("path", "")), tmpdir),
            lineStart=int(item.get("start", {}).get("line", 0)),
            message=message,
            codeSnippet=snippet or None,
        )

    @staticmethod
    def _relative_path(path_raw: str, tmpdir: str) -> str:
        """Returns the path relative to the repository root.

        Semgrep returns paths inside the temporary directory: leaving them
        as-is would mean showing the user `/tmp/cg_sast_xyz/src/app.py`
        and, worse, writing a system path into a persisted report.

        Args:
            path_raw (str): The path emitted by Semgrep.
            tmpdir (str): The scan directory.

        Returns:
            str: The path relative to the repository.
        """
        if not path_raw:
            return "unknown"
        try:
            return os.path.relpath(path_raw, tmpdir).replace(os.sep, "/")
        except ValueError:
            # Different volumes on Windows: no relative path is possible.
            return path_raw

    @staticmethod
    def _dedup(findings: list[SastFindingBlock]) -> list[SastFindingBlock]:
        """Keeps a single occurrence per (rule, file, line).

        The key includes the line on purpose: the same rule violated in two
        different points of the same file are two problems to fix, not one.
        Only true duplicates are excluded, which Semgrep can emit when
        multiple rulesets contain the same rule.

        Args:
            findings (list[SastFindingBlock]): The findings to deduplicate.

        Returns:
            list[SastFindingBlock]: The unique findings, in original order.
        """
        seen: set[tuple[str, str, int]] = set()
        unique: list[SastFindingBlock] = []
        for finding in findings:
            key = (finding.ruleId, finding.filePath, finding.lineStart)
            if key not in seen:
                seen.add(key)
                unique.append(finding)
        return unique

    @staticmethod
    def _sort_by_severity(findings: list[SastFindingBlock]) -> list[SastFindingBlock]:
        """Sorts by native Semgrep severity, descending.

        Args:
            findings (list[SastFindingBlock]): The findings to sort.

        Returns:
            list[SastFindingBlock]: The sorted findings.
        """
        return sorted(findings, key=lambda f: _SEVERITY_RANK.get(f.ruleSeverity, 99))

    @staticmethod
    def _empty_summary() -> SastSummaryBlock:
        """Summary of a scan that was executed and found nothing.

        Returns:
            SastSummaryBlock: A zero summary.
        """
        return SastSummaryBlock(totalFindings=0)

    def format_for_prompt(
        self, findings: list[SastFindingBlock], summary: SastSummaryBlock
    ) -> str:
        """Renders the findings in the prompt section the LLM must judge.

        Args:
            findings (list[SastFindingBlock]): The findings to submit.
            summary (SastSummaryBlock): The scan summary.

        Returns:
            str: The Markdown section to prepend to the file list.
        """
        if not findings:
            return ""

        lines: list[str] = ["### SAST Analysis (Semgrep / OWASP Top Ten)\n"]
        lines.append(
            f"Files scanned: {summary.scannedFiles} | "
            f"Total findings: {summary.totalFindings} | "
            f"Submitted for judgment: {len(findings)}"
        )
        if summary.timedOut:
            lines.append("Warning: Semgrep exceeded the timeout, partial results.\n")
        if summary.cappedFindings:
            lines.append(
                f"Warning: {summary.cappedFindings} findings excluded by the limit "
                "(priority ERROR > WARNING > INFO).\n"
            )

        for finding in findings:
            lines.append(
                f"\n**[{finding.ruleSeverity}] {finding.ruleId}** -- {finding.owaspCategory}"
                + (f" ({finding.cwe})" if finding.cwe else "")
            )
            lines.append(f"  File: `{finding.filePath}` line {finding.lineStart}")
            lines.append(f"  {finding.message}")
            if finding.codeSnippet:
                lines.append(f"  ``\n  {finding.codeSnippet}\n  ``")

        return "\n".join(lines)
