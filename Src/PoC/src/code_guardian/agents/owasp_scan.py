"""Agente OWASP -- operazione `owasp_scan` (UC38).

Sul modello vige il vincolo RV.13: deve essere Claude. Il grafo non lo impone,
lo impone la configurazione (`LLM_PROVIDER=anthropic`).

L'agente si limita a SEGNALARE: la valutazione e l'applicazione dei correttivi
restano in capo al Security Auditor (RS.1).
"""

from __future__ import annotations

from ..errors import ParseError
from ..models import (
    SEVERITY_ORDER,
    Block,
    FindingBlock,
    Location,
    Proposal,
    SnippetRemediation,
    TextRemediation,
)
from ..ports import AgentProfile, LoadedContext, Prompt
from ._base import extract_json, load_template, number_lines, render

#: Sinonimi accettati in ingresso e loro normalizzazione (il modello varia).
_SEVERITY_ALIASES = {
    "informational": "info",
    "informative": "info",
    "note": "info",
    "minor": "low",
    "moderate": "medium",
    "med": "medium",
    "major": "high",
    "severe": "critical",
    "blocker": "critical",
}


class OwaspScanProfile(AgentProfile):
    agent = "owasp"
    operation = "owasp_scan"

    def __init__(self, template: str = "owasp_scan") -> None:
        self._template = template
        self._known_files: dict[str, int] = {}

    # -- composizione del prompt -------------------------------------------

    def build_prompt(self, ctx: LoadedContext) -> Prompt:
        system, user_tpl = load_template(self._template)

        # Memorizza i file dell'ambito: serve a validare i riferimenti in uscita.
        self._known_files = {p: len(t.splitlines()) for p, t in ctx.files}

        blocks = [
            f"### File: {path}\n```\n{number_lines(text)}\n```"
            for path, text in ctx.files
        ]

        policy = ""
        if claude_md := ctx.extra.get("claude_md"):
            policy = (
                "Considera inoltre le regole di sviluppo sicuro definite dal team "
                f"nel file CLAUDE.md:\n```\n{claude_md}\n```\n"
            )

        return Prompt(system=system, user=render(user_tpl, policy=policy, files="\n\n".join(blocks)))

    # -- validazione e parsing ---------------------------------------------

    def parse_output(self, raw: str) -> tuple[tuple[Block, ...], Proposal | None]:
        data = extract_json(raw)
        if "findings" not in data:
            raise ParseError("Chiave 'findings' assente nella risposta.")
        if not isinstance(data["findings"], list):
            raise ParseError("'findings' non e' una lista.")

        blocks: list[Block] = [self._to_finding(item, i) for i, item in enumerate(data["findings"])]
        # Ordina per gravita' decrescente: l'utente vede prima cio' che conta.
        blocks.sort(key=lambda b: SEVERITY_ORDER.index(b.severity), reverse=True)  # type: ignore[attr-defined]
        return tuple(blocks), None

    # -- interni ------------------------------------------------------------

    def _to_finding(self, item: object, idx: int) -> FindingBlock:
        if not isinstance(item, dict):
            raise ParseError(f"Riscontro #{idx} non e' un oggetto.")

        for key in ("category", "file", "message"):
            if not item.get(key):
                raise ParseError(f"Riscontro #{idx}: campo '{key}' mancante.")

        path = str(item["file"])
        if self._known_files and path not in self._known_files:
            raise ParseError(f"Riscontro #{idx}: file {path!r} non appartiene all'ambito.")

        start, end = self._lines(item, idx, path)

        return FindingBlock(
            category=str(item["category"]),
            severity=self._severity(item.get("severity"), idx),
            location=Location(file=path, start_line=start, end_line=end),
            message=str(item["message"]),
            remediation=self._remediation(item.get("remediation"), idx),
        )

    def _lines(self, item: dict, idx: int, path: str) -> tuple[int, int]:
        try:
            start = int(item.get("start_line", 1))
            end = int(item.get("end_line", start))
        except (TypeError, ValueError) as exc:
            raise ParseError(f"Riscontro #{idx}: numeri di riga non interi.") from exc

        if start < 1:
            raise ParseError(f"Riscontro #{idx}: start_line deve essere >= 1.")
        if end < start:
            end = start

        # Il modello puo' allucinare righe oltre la fine del file: le tronchiamo.
        if limit := self._known_files.get(path):
            start, end = min(start, limit), min(end, limit)
        return start, end

    @staticmethod
    def _severity(value: object, idx: int) -> str:
        if value is None:
            return "medium"
        v = str(value).strip().lower()
        v = _SEVERITY_ALIASES.get(v, v)
        if v not in SEVERITY_ORDER:
            raise ParseError(f"Riscontro #{idx}: gravita' {value!r} non riconosciuta.")
        return v

    @staticmethod
    def _remediation(value: object, idx: int):
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ParseError(f"Riscontro #{idx}: 'remediation' non e' un oggetto.")

        kind = value.get("kind")
        if kind == "snippet":
            if not value.get("code"):
                raise ParseError(f"Riscontro #{idx}: snippet privo di 'code'.")
            return SnippetRemediation(language=str(value.get("language", "text")), code=str(value["code"]))
        if kind == "text":
            if not value.get("markdown"):
                raise ParseError(f"Riscontro #{idx}: remediation testuale vuota.")
            return TextRemediation(markdown=str(value["markdown"]))
        raise ParseError(f"Riscontro #{idx}: 'kind' della remediation non valido: {kind!r}.")
