from __future__ import annotations

import re
from typing import Any, Optional

from ..config import settings
from ..github_toolset import GitHubToolset
from ..models import Block, Proposal, TextBlock, ComplexityWarningBlock
from ..sonarqube_service import SonarQubeCredentials, SonarQubeService
from ._base import extract_json, load_prompt_template, render_prompt

try:
    import lizard
    _LIZARD_AVAILABLE = True
except ImportError:
    _LIZARD_AVAILABLE = False


_CC_THRESHOLD = 10
_SUPPORTED_EXTS = (".ts", ".js", ".py", ".java", ".go", ".rb")


class DocsLoader:
    def __init__(self, sonarqube_service: Optional[SonarQubeService] = None):
        self._sonar = sonarqube_service

    def _find_undocumented_units(self, content: str, filepath: str) -> list[str]:
        lines = content.split("\n")
        undocumented: list[str] = []

        if filepath.endswith(".py"):
            for i, line in enumerate(lines):
                stripped = line.strip()
                if stripped.startswith("def ") or stripped.startswith("class "):
                    has_doc = False
                    for j in range(i + 1, min(i + 4, len(lines))):
                        next_line = lines[j].strip()
                        if next_line:
                            if next_line.startswith('"""') or next_line.startswith("'''"):
                                has_doc = True
                            break
                    if not has_doc:
                        match = re.search(r"(def|class)\s+([a-zA-Z0-9_]+)", line)
                        if match:
                            undocumented.append(f"Riga {i + 1}: {match.group(2)}")
        else:
            for i, line in enumerate(lines):
                if re.search(
                    r"(function\s+[a-zA-Z0-9_]+|class\s+[a-zA-Z0-9_]+|"
                    r"const\s+[a-zA-Z0-9_]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>)",
                    line,
                ):
                    has_doc = False
                    for j in range(i - 1, max(i - 4, -1), -1):
                        prev_line = lines[j].strip()
                        if prev_line:
                            if prev_line.endswith("*/") or prev_line.startswith("//"):
                                has_doc = True
                            break
                    if not has_doc:
                        match = re.search(r"(?:function|class|const)\s+([a-zA-Z0-9_]+)", line)
                        if match:
                            undocumented.append(f"Riga {i + 1}: {match.group(1)}")

        return undocumented

    def _analyze_complexity(self, content: str, filepath: str) -> list[dict]:
        if not _LIZARD_AVAILABLE:
            return []
        try:
            result = lizard.analyze_file.analyze_source_code(filepath, content)
            warnings = []
            for fn in result.function_list:
                if fn.cyclomatic_complexity > _CC_THRESHOLD:
                    warnings.append({
                        "file_path": filepath,
                        "function_name": fn.name,
                        "cyclomatic_complexity": fn.cyclomatic_complexity,
                        "threshold": _CC_THRESHOLD,
                    })
            return warnings
        except Exception:
            return []

    async def load(self, context_ref: Any, toolset: GitHubToolset) -> dict:
        owner = context_ref.repoOwner
        repo = context_ref.repoName
        sha = context_ref.ref
        scope_type = getattr(context_ref, "scopeType", "FULL_REPOSITORY")
        paths = getattr(context_ref, "paths", [])

        tree_response = await toolset.read_tree(owner, repo, sha)
        nodes = tree_response.get("nodes", [])

        package_json = "Non trovato."
        readme = "Non trovato."
        for node in nodes:
            if node["path"].lower() == "package.json":
                resp = await toolset.read_file(owner, repo, sha, node["path"])
                package_json = resp.get("content", "Non trovato.")
            elif node["path"].lower() == "readme.md":
                resp = await toolset.read_file(owner, repo, sha, node["path"])
                readme = resp.get("content", "Non trovato.")

        files_to_doc = [
            n["path"]
            for n in nodes
            if n["type"] == "file" and n["path"].endswith(_SUPPORTED_EXTS)
            and (scope_type == "FULL_REPOSITORY" or any(n["path"].startswith(p) for p in paths))
        ]

        undocumented_summary: list[str] = []
        complexity_warnings: list[dict] = []
        file_contents: dict[str, str] = {}

        for path in files_to_doc:
            resp = await toolset.read_file(owner, repo, sha, path)
            content = resp.get("content", "")
            if not content:
                continue
            file_contents[path] = content
            units = self._find_undocumented_units(content, path)
            if units:
                undocumented_summary.append(
                    f"### File: {path} ###\n```\n{content}\n```\n"
                    f"Unità da documentare: {', '.join(units)}\n"
                )
            complexity_warnings.extend(self._analyze_complexity(content, path))

        code_units_text = (
            "Nessuna unità priva di documentazione trovata nell'ambito selezionato."
            if not undocumented_summary
            else "Codice sorgente dei file con unità non documentate:\n\n" + "\n\n".join(undocumented_summary)
        )

        sonar_section = ""
        if settings.enable_sonarqube and self._sonar:
            try:
                creds_data = await toolset.get_sonarqube_credentials()
                if creds_data:
                    creds = SonarQubeCredentials.from_dict(creds_data)
                    metrics = await self._sonar.get_metrics(creds, sha)
                    changed = getattr(context_ref, "changedFiles", [])
                    sonar_section = self._sonar.format_for_prompt(metrics, changed)
            except Exception:
                pass

        await toolset.report_progress(stage="docs_context_loaded", percent=30)

        return {
            "language": "Determinalo in base ai file",
            "code_units": code_units_text,
            "package_json": package_json,
            "readme": readme,
            "sonar_section": sonar_section,
            "complexity_warnings": complexity_warnings,
            "file_contents": file_contents,
        }


class DocsProfile:
    agent = "docs"
    operation = "DOCS_INLINE"
    uses_tools = False
    max_tool_rounds = 0

    def __init__(self):
        self._ctx: dict = {}

    def build_prompt(self, ctx: dict) -> tuple[str, str]:
        self._ctx = ctx
        template_data = load_prompt_template("docs", "inline_docs")

        extra_sections = ""
        if ctx.get("sonar_section"):
            extra_sections += "\n\n" + ctx["sonar_section"]

        return render_prompt(
            template_data,
            language=ctx["language"],
            code_units=ctx["code_units"] + extra_sections,
            package_json=ctx.get("package_json", "Non trovato."),
            readme=ctx.get("readme", "Non trovato."),
        )

    def parse_output(self, raw: str) -> tuple[list[Block], Optional[Proposal]]:
        data = extract_json(raw)
        blocks: list[Block] = []

        for w in self._ctx.get("complexity_warnings", []):
            blocks.append(
                ComplexityWarningBlock(
                    file_path=w["file_path"],
                    function_name=w["function_name"],
                    cyclomatic_complexity=w["cyclomatic_complexity"],
                    threshold=w["threshold"],
                    suggestion="Considera il refactoring per ridurre la complessità ciclomatica.",
                )
            )

        for w in data.get("warnings", []):
            blocks.append(
                TextBlock(
                    content=(
                        f"**Avviso:** L'unità `{w.get('unit', 'unità')}` in `{w.get('file', 'unknown')}` "
                        f"(riga {w.get('line', '?')}) è stata saltata. Motivo: {w.get('message', '')}"
                    )
                )
            )

        docs_list = data.get("docs", [])
        if not docs_list:
            return blocks, None

        docs_by_file: dict[str, list[dict]] = {}
        for d in docs_list:
            f = d.get("file", "unknown_file")
            docs_by_file.setdefault(f, []).append(d)

        diff_unified = ""
        for f, items in docs_by_file.items():
            diff_unified += f"--- a/{f}\n+++ b/{f}\n"
            for item in items:
                line = item.get("line", 1)
                doc_text = item.get("doc", "")
                doc_lines = doc_text.splitlines()
                diff_unified += f"@@ -{line},0 +{line},{len(doc_lines)} @@\n"
                for dl in doc_lines:
                    diff_unified += f"+{dl}\n"

        files_involved = list(docs_by_file.keys())
        target_path = files_involved[0] if len(files_involved) == 1 else "Multi-file scope"

        proposal = Proposal(
            task_id="",
            agent_type="docs",
            unified_diff=diff_unified,
            model="",
        )
        proposal.__dict__["target_path"] = target_path

        return blocks, proposal
