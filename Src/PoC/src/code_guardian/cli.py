"""Programma di prova (driver).

Sostituisce l'Orchestratore, che è fuori dal perimetro del PoC. È l'UNICO punto
del sistema che vede insieme tutte le classi concrete: le sceglie in base agli
argomenti e alla configurazione, e le inietta nel grafo.

Esempi:
    python -m code_guardian.cli owasp     --repo examples/sample_repo
    python -m code_guardian.cli docs      --repo examples/sample_repo --scope src
    python -m code_guardian.cli changelog --tasks examples/sprint_tasks.json --sprint S-12

Lanciata senza argomenti, la CLI entra invece in una modalità guidata: chiede
agente e modello a domande, poi si comporta esattamente come sopra (vedi
`run_wizard`). Al termine chiede se eseguire un'altra operazione, così puoi
provare più agenti o più repository senza rilanciare il comando ogni volta;
l'invocazione con i flag resta invece a esecuzione singola, per non
sorprendere script e pipeline CI.
"""

from __future__ import annotations

import argparse
import getpass
import sys
from typing import Callable

from .agents import ChangelogTechProfile, DocsInlineProfile, OwaspScanProfile
from .config import settings
from .context import LocalRepoLoader, TaskFixtureLoader
from .graph import AgentGraph
from .llm import build_provider
from .models import ContextRef
from .render import to_markdown
from .ports import AgentProfile, ContextLoader

AGENT_CHOICES = [
    ("owasp", "OWASP — cerca vulnerabilità di sicurezza nel codice"),
    ("docs", "Docs — propone documentazione per il codice non commentato"),
    ("changelog", "Changelog — riassume le attività completate in uno sprint"),
]

PROVIDER_CHOICES = [
    ("anthropic", "Claude (Anthropic) — la qualità migliore, richiede una chiave API a pagamento"),
    ("ollama", "Ollama — gratis, gira in locale, deve essere già avviato"),
    ("fake", "Fake — nessuna rete, risposta finta: verifica solo che l'app funzioni, NON produce riscontri reali"),
]


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
    p.add_argument(
        "--timeout",
        type=int,
        default=None,
        help=(
            "limite in secondi; default in base al provider "
            f"({settings.agent_timeout_s}s, RQ.7, o {settings.ollama_agent_timeout_s}s per ollama)"
        ),
    )
    p.add_argument("--format", choices=["json", "md"], default="md", help="formato dell'esito")
    return p


# -- modalità guidata --------------------------------------------------------
#
# Attiva solo quando la CLI è lanciata senza argomenti: chi conosce già i
# flag continua a usarli esattamente come prima, in modo scriptabile (CI
# compresa). Chi non li conosce risponde a qualche domanda.
#
# `run_wizard` non duplica la logica di `build_parser`/`_wire`: si limita a
# raccogliere le risposte e a tradurle nella stessa lista di argomenti che la
# CLI accetterebbe da riga di comando, che poi passa per il parser normale.


def _choose(prompt: str, choices: list[tuple[str, str]], input_fn: Callable[[str], str]) -> str:
    """Mostra un menu numerato; Invio sceglie la prima opzione."""
    print(prompt)
    for i, (_, label) in enumerate(choices, 1):
        print(f"  {i}. {label}")
    while True:
        raw = input_fn(f"Scelta [1-{len(choices)}, Invio per la prima]: ").strip()
        if not raw:
            return choices[0][0]
        if raw.isdigit() and 1 <= int(raw) <= len(choices):
            return choices[int(raw) - 1][0]
        print("Non ho capito la risposta, riprova.")


def _ask_path(prompt: str, default: str, input_fn: Callable[[str], str]) -> str:
    raw = input_fn(f"{prompt} [{default}]: ").strip()
    return raw or default


def run_wizard(
    input_fn: Callable[[str], str] = input,
    secret_fn: Callable[[str], str] = getpass.getpass,
) -> tuple[list[str], str | None]:
    """Raccoglie le scelte dell'utente e le traduce nell'equivalente riga di comando.

    Restituisce `(argv, api_key)`. `api_key` è la chiave Anthropic inserita
    a mano quando il provider scelto è `anthropic` (chiesta sempre, con
    `getpass` per non farla comparire a schermo); vale solo per questa
    esecuzione e non viene mai scritta su `.env` né altrove. Invio senza
    digitare nulla lascia decidere alla configurazione abituale (`.env` o
    ambiente), esattamente come nell'invocazione con i flag.
    """
    agent = _choose("Quale agente vuoi eseguire?", AGENT_CHOICES, input_fn)
    provider = _choose("\nQuale modello vuoi usare?", PROVIDER_CHOICES, input_fn)

    api_key = None
    if provider == "anthropic":
        raw = secret_fn(
            "Chiave ANTHROPIC_API_KEY (Invio per usare quella già configurata, se c'è; "
            "non viene salvata su disco): "
        ).strip()
        api_key = raw or None
    print()

    argv = [agent, "--provider", provider]
    if agent == "changelog":
        tasks = _ask_path("File dei task (JSON)", "examples/sprint_tasks.json", input_fn)
        sprint = input_fn("Sprint da includere (facoltativo, Invio per saltare): ").strip()
        argv += ["--tasks", tasks]
        if sprint:
            argv += ["--sprint", sprint]
    else:
        repo = _ask_path("Percorso del repository da analizzare", "examples/sample_repo", input_fn)
        argv += ["--repo", repo]

    print()
    return argv, api_key


def _ask_continue(input_fn: Callable[[str], str] = input) -> bool:
    """Chiede se eseguire un'altra operazione. Invio, input esaurito o
    risposta non affermativa: no."""
    try:
        raw = input_fn("Vuoi eseguire un'altra operazione? [s/N]: ")
    except EOFError:
        return False
    return raw.strip().lower() in ("s", "si", "sì", "y", "yes")


def _run_once(raw_argv: list[str], api_key: str | None) -> int:
    """Esegue un agente e stampa il report. Usata sia dall'invocazione con i
    flag (una sola volta) sia da ciascun giro della modalità guidata."""
    args = build_parser().parse_args(raw_argv)

    loader, profile, ref = _wire(args)
    try:
        provider = build_provider(args.provider, api_key=api_key)
    except RuntimeError as exc:
        # Configurazione mancante (es. ANTHROPIC_API_KEY assente): non è un
        # errore dell'agente, quindi non passa dal grafo — il provider non
        # esiste ancora a questo punto. Lo segnaliamo senza far esplodere il
        # processo, cosi' la modalità guidata puo' tornare al menu invece di
        # chiudersi con un traceback.
        print(f"Configurazione mancante: {exc}")
        return 1

    # Stessa risoluzione di build_provider(): se --timeout non è stato dato
    # esplicitamente, il default dipende dal provider effettivo (ollama, in
    # locale, è strutturalmente più lento di Claude — vedi config.py).
    timeout_s = args.timeout
    if timeout_s is None:
        provider_name = (args.provider or settings.llm_provider).lower()
        timeout_s = settings.ollama_agent_timeout_s if provider_name == "ollama" else settings.agent_timeout_s

    graph = AgentGraph(loader=loader, profile=profile, provider=provider, timeout_s=timeout_s)

    report = graph.run(ref)

    print(report.to_json() if args.format == "json" else to_markdown(report))
    # Codice d'uscita non nullo se l'agente è fallito: utile in pipeline CI.
    return 1 if report.status == "fallito" else 0


def main(argv: list[str] | None = None) -> int:
    raw_argv = sys.argv[1:] if argv is None else argv
    if raw_argv:
        # Argomenti espliciti: un'esecuzione sola, comportamento scriptabile
        # invariato (script, CI). Il ciclo qui sotto vale solo per la
        # modalità guidata.
        return _run_once(raw_argv, api_key=None)

    print("Nessun comando indicato: parto in modalità guidata.\n")

    exit_code = 0
    while True:
        try:
            wizard_argv, wizard_api_key = run_wizard()
        except EOFError:
            print("Nessun input disponibile: passa gli argomenti da riga di comando (--help per l'elenco).")
            return 1
        except KeyboardInterrupt:
            print("\nInterrotto.")
            return 130

        exit_code = _run_once(wizard_argv, wizard_api_key)

        print()
        try:
            if not _ask_continue():
                break
        except KeyboardInterrupt:
            print("\nInterrotto.")
            break
        print()

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
