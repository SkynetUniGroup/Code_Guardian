"""Resa del Report in Markdown leggibile (il JSON resta la forma canonica)."""

from __future__ import annotations

from .models import FindingBlock, Report, SnippetRemediation, TextBlock, TextRemediation

_BADGE = {
    "critical": "CRITICA",
    "high": "ALTA",
    "medium": "MEDIA",
    "low": "BASSA",
    "info": "INFO",
}


def to_markdown(report: Report) -> str:
    out: list[str] = []
    out.append(f"# Report — agente `{report.agent}` ({report.operation})")
    out.append("")
    out.append(f"- **Stato**: {report.status}")
    out.append(f"- **Durata**: {report.duration_ms} ms")
    if report.context.repo_url:
        out.append(f"- **Repository**: {report.context.repo_url}")
    if report.context.sprint_id:
        out.append(f"- **Sprint**: {report.context.sprint_id}")
    out.append("")

    if report.error:
        out.append(f"## Errore ({report.error.type})\n\n> {report.error.message}\n")
        return "\n".join(out)

    findings = [b for b in report.blocks if isinstance(b, FindingBlock)]
    texts = [b for b in report.blocks if isinstance(b, TextBlock)]

    for tb in texts:
        out.append(tb.content)
        out.append("")

    if findings:
        out.append(f"## Riscontri ({len(findings)})")
        out.append("")
        for f in findings:
            loc = f"{f.location.file}:{f.location.start_line}"
            if f.location.end_line != f.location.start_line:
                loc += f"-{f.location.end_line}"
            out.append(f"### [{_BADGE.get(f.severity, f.severity)}] {f.category}")
            out.append(f"`{loc}`")
            out.append("")
            out.append(f.message)
            if isinstance(f.remediation, SnippetRemediation):
                out.append("")
                out.append("**Correzione proposta:**")
                out.append(f"```{f.remediation.language}\n{f.remediation.code}\n```")
            elif isinstance(f.remediation, TextRemediation):
                out.append("")
                out.append(f"**Rimedio:** {f.remediation.markdown}")
            out.append("")

    if report.proposal:
        n = len(report.proposal.files)
        out.append(f"## Proposta di modifica ({n} file)")
        out.append("")
        out.append("> Proposta non applicata: richiede validazione umana (RS.1).")
        out.append("")
        for fc in report.proposal.files:
            out.append(f"### `{fc.path}`")
            out.append(f"```diff\n{fc.unified_diff}```")
            out.append("")

    return "\n".join(out)
