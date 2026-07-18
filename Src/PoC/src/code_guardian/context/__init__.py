"""Realizzazioni della porta `ContextLoader`."""

from __future__ import annotations

import json
from pathlib import Path

from ..config import settings
from ..errors import ContextMissing
from ..models import ContextRef
from ..ports import ContextLoader, LoadedContext

SKIP_DIRS = {".git", "node_modules", "__pycache__", "venv", ".venv", "dist", "build"}


class LocalRepoLoader(ContextLoader):
    """Legge da un clone Git LOCALE (nessun accesso all'API GitHub).

    Applica il filtro sui linguaggi supportati (RV.6) e il limite dimensionale
    dell'ambito. Se presente, carica `CLAUDE.md` in `extra` per la variante
    policy-as-code dell'agente OWASP (UC39).
    """

    def __init__(self, root: str | Path, extensions: tuple[str, ...] | None = None) -> None:
        self.root = Path(root).resolve()
        self.exts = extensions or settings.supported_extensions

    def load(self, ref: ContextRef) -> LoadedContext:
        if not self.root.is_dir():
            raise ContextMissing(f"Repository non trovato: {self.root}")

        roots = [self.root / s for s in ref.scope] if ref.scope else [self.root]
        files: list[tuple[str, str]] = []
        budget = settings.max_scope_chars

        for base in roots:
            if not base.exists():
                raise ContextMissing(f"Ambito inesistente: {base}")
            for p in sorted(base.rglob("*") if base.is_dir() else [base]):
                if not p.is_file() or p.suffix not in self.exts:
                    continue
                if any(part in SKIP_DIRS for part in p.parts):
                    continue
                try:
                    text = p.read_text(encoding="utf-8")
                except (UnicodeDecodeError, OSError):
                    continue
                if len(text) > budget:
                    break
                budget -= len(text)
                files.append((str(p.relative_to(self.root)), text))

        extra: dict = {}
        claude_md = self.root / "CLAUDE.md"
        if claude_md.is_file():
            extra["claude_md"] = claude_md.read_text(encoding="utf-8")

        return LoadedContext(files=tuple(files), extra=extra)


class TaskFixtureLoader(ContextLoader):
    """Legge le User Stories da una fixture JSON (simula GitHub Issues).

    Scelta deliberata: rende il PoC riproducibile e offline. In produzione
    questa classe viene sostituita da un adapter verso il sistema di task
    management, senza che agente e grafo se ne accorgano.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def load(self, ref: ContextRef) -> LoadedContext:
        if not self.path.is_file():
            raise ContextMissing(f"Fixture dei task non trovata: {self.path}")
        data = json.loads(self.path.read_text(encoding="utf-8"))
        tasks = data.get("tasks", [])

        if ref.sprint_id:
            tasks = [t for t in tasks if t.get("sprint_id") == ref.sprint_id]
            if not tasks:
                raise ContextMissing(f"Nessun task per lo sprint {ref.sprint_id!r}.")

        return LoadedContext(payload=tasks, extra={"sprint_id": ref.sprint_id})
