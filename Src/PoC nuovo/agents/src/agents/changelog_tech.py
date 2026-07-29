"""Agente Changelog -- operazione `changelog_tech` (UC40).

Due lavorazioni avvengono PRIMA di interrogare il modello:
  1. filtro delle attivita' effettivamente completate;
  2. cancello di qualita' sui metadati (UC42): le storie con descrizione vuota o
     troppo povera, o prive di criteri di accettazione, vengono ESCLUSE.

Si segue il percorso "procedi escludendo": le storie scartate sono elencate nel
report, cosicche' l'esito dichiari con trasparenza il proprio ambito.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..errors import ContextMissing, ParseError
from ..models import Block, FindingBlock, Location, Proposal, TextBlock
from ..ports import AgentProfile, LoadedContext, Prompt
from ._base import load_template, render

DONE_STATES = {"done", "closed", "completed", "completato", "chiuso"}

#: Soglia minima di una descrizione utile. Sotto questa, la storia non porta informazione sufficiente per un changelog e viene esclusa.
MIN_DESCRIPTION_CHARS = 30


@dataclass(frozen=True)
class Excluded:
    task_id: str
    title: str
    reason: str


class ChangelogTechProfile(AgentProfile):
    agent = "changelog"
    operation = "changelog_tech"

    def __init__(self, template: str = "changelog_tech") -> None:
        self._template = template
        self._excluded: list[Excluded] = []
        self._kept: list[dict] = []
        self._sprint_id: str = "?"

    # -- composizione del prompt

    def build_prompt(self, ctx: LoadedContext) -> Prompt:
        system, user_tpl = load_template(self._template)
        tasks = list(ctx.payload or [])
        self._sprint_id = str(ctx.extra.get("sprint_id") or "?")

        completed = [t for t in tasks if str(t.get("status", "")).lower() in DONE_STATES]
        self._kept, self._excluded = self.quality_gate(completed)

        if not self._kept:
            raise ContextMissing(
                "Nessuna storia completata supera il controllo di qualita' dei metadati."
            )

        return Prompt(
            system=system,
            user=render(user_tpl, sprint_id=self._sprint_id, tasks=self._format(self._kept)),
        )

    # -- cancello di qualita' (UC42)

    @staticmethod
    def quality_gate(tasks: list[dict]) -> tuple[list[dict], list[Excluded]]:
        kept: list[dict] = []
        excluded: list[Excluded] = []
        for t in tasks:
            tid = str(t.get("id", "?"))
            title = str(t.get("title", "")).strip()
            desc = str(t.get("description", "") or "").strip()
            criteria = t.get("acceptance_criteria") or []

            if not title:
                excluded.append(Excluded(tid, "(senza titolo)", "titolo mancante"))
            elif len(desc) < MIN_DESCRIPTION_CHARS:
                excluded.append(Excluded(tid, title, "descrizione assente o troppo povera"))
            elif not criteria:
                excluded.append(Excluded(tid, title, "criteri di accettazione mancanti"))
            else:
                kept.append(t)
        return kept, excluded

    @staticmethod
    def _format(tasks: list[dict]) -> str:
        out = []
        for t in tasks:
            criteria = "\n".join(f"    - {c}" for c in t.get("acceptance_criteria", []))
            labels = ", ".join(t.get("labels", [])) or "-"
            out.append(
                f"- [{t.get('id')}] {t.get('title')}\n"
                f"  Etichette: {labels}\n"
                f"  Descrizione: {t.get('description')}\n"
                f"  Criteri di accettazione:\n{criteria}"
            )
        return "\n\n".join(out)

    # -- validazione e parsing

    def parse_output(self, raw: str) -> tuple[tuple[Block, ...], Proposal | None]:
        # L'esito e' prosa Markdown, non dati strutturati: la validazione e' piu'lieve, ma non assente.
        text = (raw or "").strip()
        if not text:
            raise ParseError("Il modello ha restituito un changelog vuoto.")
        if text.startswith("```"):
            text = text.strip("`").lstrip("markdown").strip()
        if len(text) < 20:
            raise ParseError("Il changelog prodotto e' troppo breve per essere valido.")

        blocks: list[Block] = [TextBlock(content=self._enrich(text))]
        blocks.extend(
            FindingBlock(
                category="avviso",
                severity="info",
                location=Location(file=f"task:{e.task_id}", start_line=1, end_line=1),
                message=f"Storia esclusa dal changelog ({e.reason}): {e.title}",
            )
            for e in self._excluded
        )
        return tuple(blocks), None


    def _enrich(self, markdown: str) -> str:
        """Aggiunge in coda i collegamenti alle storie originarie."""
        links = [
            f"- [{t.get('id')}]({t['url']}) — {t.get('title')}"
            for t in self._kept
            if t.get("url")
        ]
        if not links:
            return markdown
        return markdown.rstrip() + "\n\n## Storie incluse\n" + "\n".join(links) + "\n"
