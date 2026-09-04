from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

from .config import settings
from .models import SASTFindingBlock, SASTSummary

logger = logging.getLogger(__name__)

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


class SASTAnalyzer:
    def __init__(self, timeout_s: Optional[int] = None, max_findings: Optional[int] = None):
        self._timeout_s = timeout_s or settings.semgrep_timeout_s
        self._max_findings = max_findings or settings.sast_max_findings_llm

    async def analyze(
        self,
        files: dict[str, str],
    ) -> tuple[list[SASTFindingBlock], SASTSummary]:
        if not files:
            return [], self._empty_summary()

        start_ms = int(time.time() * 1000)
        timed_out = False
        raw_findings: list[dict[str, Any]] = []

        with tempfile.TemporaryDirectory(prefix="cg_sast_") as tmpdir:
            file_paths = self._write_files(tmpdir, files)
            extensions = {Path(p).suffix.lstrip(".") for p in files}
            rulesets = self._build_rulesets(extensions)

            try:
                raw_findings = await asyncio.wait_for(
                    self._run_semgrep(tmpdir, rulesets),
                    timeout=self._timeout_s,
                )
            except asyncio.TimeoutError:
                logger.warning("Semgrep timed out after %ds — continuing without SAST results", self._timeout_s)
                timed_out = True

        duration_ms = int(time.time() * 1000) - start_ms

        findings = self._parse_findings(raw_findings, tmpdir if not timed_out else "")
        findings = self._dedup(findings)
        findings = self._sort_by_severity(findings)

        capped = max(0, len(findings) - self._max_findings)
        capped_findings = findings[: self._max_findings]
        for f in capped_findings:
            if f.llm_verdict == "NEEDS_REVIEW":
                pass

        summary = SASTSummary(
            total_findings=len(findings),
            confirmed_findings=sum(1 for f in capped_findings if f.llm_verdict == "CONFIRMED"),
            false_positives=sum(1 for f in capped_findings if f.llm_verdict == "FALSE_POSITIVE"),
            needs_review=sum(1 for f in capped_findings if f.llm_verdict == "NEEDS_REVIEW"),
            capped_findings=capped,
            scanned_files=len(files),
            duration_ms=duration_ms,
            timed_out=timed_out,
        )

        return capped_findings, summary

    def _write_files(self, tmpdir: str, files: dict[str, str]) -> list[str]:
        paths: list[str] = []
        for rel_path, content in files.items():
            full_path = os.path.join(tmpdir, rel_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as fh:
                fh.write(content)
            paths.append(full_path)
        return paths

    def _build_rulesets(self, extensions: set[str]) -> list[str]:
        rulesets = list(_OWASP_RULESETS)
        for ext in extensions:
            rulesets.extend(_LANGUAGE_RULESETS.get(ext, []))
        return list(dict.fromkeys(rulesets))

    async def _run_semgrep(self, target_dir: str, rulesets: list[str]) -> list[dict[str, Any]]:
        config_args: list[str] = []
        for rs in rulesets:
            config_args += ["--config", rs]

        cmd = [
            "semgrep",
            *config_args,
            "--json",
            "--no-rewrite-rule-ids",
            "--max-target-bytes", "1000000",
            target_dir,
        ]

        logger.debug("Running semgrep: %s", " ".join(cmd))
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if stderr:
            logger.debug("semgrep stderr: %s", stderr.decode("utf-8", errors="replace")[:500])

        if not stdout:
            return []

        try:
            data = json.loads(stdout.decode("utf-8"))
            return data.get("results", [])
        except json.JSONDecodeError:
            logger.warning("Failed to parse semgrep JSON output")
            return []

    def _parse_findings(self, raw: list[dict[str, Any]], tmpdir: str) -> list[SASTFindingBlock]:
        findings: list[SASTFindingBlock] = []
        for item in raw:
            try:
                finding = self._map_result(item, tmpdir)
                if finding:
                    findings.append(finding)
            except Exception as exc:
                logger.debug("Skipping semgrep result due to error: %s", exc)
        return findings

    def _map_result(self, item: dict[str, Any], tmpdir: str) -> Optional[SASTFindingBlock]:
        rule_id: str = item.get("check_id", "unknown")
        extra: dict = item.get("extra", {})
        metadata: dict = extra.get("metadata", {})

        raw_severity = (extra.get("severity") or "WARNING").upper()
        severity: str = raw_severity if raw_severity in _SEVERITY_RANK else "WARNING"

        owasp_refs = metadata.get("owasp", [])
        if isinstance(owasp_refs, str):
            owasp_refs = [owasp_refs]
        owasp_category = owasp_refs[0] if owasp_refs else "OWASP-UNKNOWN"

        cwe_refs = metadata.get("cwe", [])
        if isinstance(cwe_refs, str):
            cwe_refs = [cwe_refs]
        cwe = cwe_refs[0] if cwe_refs else None

        path_raw: str = item.get("path", "")
        if tmpdir and path_raw.startswith(tmpdir):
            path_raw = path_raw[len(tmpdir):].lstrip("/\\")

        start: dict = item.get("start", {})
        line: int = start.get("line", 0)

        message: str = extra.get("message", "No message").strip()
        code_snippet: Optional[str] = extra.get("lines", "").strip()
        if code_snippet and len(code_snippet) > 300:
            code_snippet = code_snippet[:297] + "..."

        return SASTFindingBlock(
            rule_id=rule_id,
            owasp_category=owasp_category,
            severity=severity,  # type: ignore[arg-type]
            file_path=path_raw,
            line=line,
            message=message,
            code_snippet=code_snippet or None,
            cwe=cwe,
            llm_verdict="NEEDS_REVIEW",
        )

    def _dedup(self, findings: list[SASTFindingBlock]) -> list[SASTFindingBlock]:
        seen: set[tuple[str, str]] = set()
        unique: list[SASTFindingBlock] = []
        for f in findings:
            key = (f.rule_id, f.file_path)
            if key not in seen:
                seen.add(key)
                unique.append(f)
        return unique

    def _sort_by_severity(self, findings: list[SASTFindingBlock]) -> list[SASTFindingBlock]:
        return sorted(findings, key=lambda f: _SEVERITY_RANK.get(f.severity, 99))

    def _empty_summary(self) -> SASTSummary:
        return SASTSummary(
            total_findings=0,
            confirmed_findings=0,
            false_positives=0,
            needs_review=0,
            capped_findings=0,
            scanned_files=0,
            duration_ms=0,
            timed_out=False,
        )

    def format_for_prompt(self, findings: list[SASTFindingBlock], summary: SASTSummary) -> str:
        lines: list[str] = []

        lines.append("### Analisi SAST (Semgrep / OWASP Top Ten)\n")
        lines.append(
            f"File analizzati: {summary.scanned_files} | "
            f"Findings totali: {summary.total_findings} | "
            f"Mostrati all'LLM: {min(summary.total_findings, self._max_findings)}"
        )
        if summary.timed_out:
            lines.append("⚠️ Semgrep ha superato il timeout — risultati parziali.\n")
        if summary.capped_findings:
            lines.append(f"⚠️ {summary.capped_findings} finding(s) esclusi dal limite (priorità ERROR>WARNING>INFO).\n")

        for f in findings:
            lines.append(
                f"\n**[{f.severity}] {f.rule_id}** — {f.owasp_category}"
                + (f" ({f.cwe})" if f.cwe else "")
            )
            lines.append(f"  File: `{f.file_path}` riga {f.line}")
            lines.append(f"  {f.message}")
            if f.code_snippet:
                lines.append(f"  ```\n  {f.code_snippet}\n  ```")

        return "\n".join(lines)
