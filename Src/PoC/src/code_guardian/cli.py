"""Programma di prova (driver).

Sostituisce l'Orchestratore, che è fuori dal perimetro del PoC. È l'UNICO punto
del sistema che vede insieme tutte le classi concrete: le sceglie in base agli
argomenti e alla configurazione, e le inietta nel grafo.

Esempi:
    python -m code_guardian.cli owasp     --repo examples/sample_repo
    python -m code_guardian.cli docs      --repo examples/sample_repo --scope src
    python -m code_guardian.cli changelog --tasks examples/sprint_tasks.json --sprint S-12
"""

from __future__ import annotations

import argparse
import sys

from .agents import ChangelogTechProfile, DocsInlineProfile, OwaspScanProfile
from .config import settings
from .context import LocalRepoLoader, TaskFixtureLoader
from .graph import AgentGraph
from .llm import build_provider
from .models import ContextRef
from .render import to_markdown
from .ports import AgentProfile, ContextLoader


def _wire(args) -> tuple[ContextLoader, AgentProfile, ContextRef]:
    """Composizione degli adapter: l'inversione delle dipendenze si risolve qui."""
    if args.agent == "changelog":
        if not args.tasks:
            raise SystemExit("L'agente changelog richiede --tasks <file.json>.")
        loader: ContextLoader = TaskFixtureLoader(args.tasks)
        profile: AgentProfile = ChangelogTechProfile()
        ref = ContextRef(sprint_id=args.sprint)
    else:
        if not args.repo:
            raise SystemExit(f"L'agente {args.agent} richiede --repo <path>.")
        loader = LocalRepoLoader(args.repo)
        profile = OwaspScanProfile() if args.agent == "owasp" else DocsInlineProfile()
        ref = ContextRef(repo_url=str(args.repo), scope=tuple(args.scope or ()))
    return loader, profile, ref


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="code-guardian", description="PoC degli agenti di Code Guardian")
    p.add_argument("agent", choices=["docs", "owasp", "changelog"])
    p.add_argument("--repo", help="percorso del clone locale del repository")
    p.add_argument("--scope", nargs="*", help="file o cartelle da analizzare (relativi al repo)")
    p.add_argument("--tasks", help="fixture JSON delle User Stories (agente changelog)")
    p.add_argument("--sprint", help="identificativo dello sprint (agente changelog)")
    p.add_argument("--provider", choices=["anthropic", "ollama", "fake"], help="fornitore di modello")
    p.add_argument("--timeout", type=int, default=settings.agent_timeout_s, help="limite in secondi (RQ.7)")
    p.add_argument("--format", choices=["json", "md"], default="md", help="formato dell'esito")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    loader, profile, ref = _wire(args)
    provider = build_provider(args.provider)
    graph = AgentGraph(loader=loader, profile=profile, provider=provider, timeout_s=args.timeout)

    report = graph.run(ref)

    print(report.to_json() if args.format == "json" else to_markdown(report))
    # Codice d'uscita non nullo se l'agente è fallito: utile in pipeline CI.
    return 1 if report.status == "fallito" else 0


if __name__ == "__main__":
    sys.exit(main())
