"""Agente Changelog -- operazione CHANGELOG_TECHNICAL.
Legge le issue da GitHub, scarta quelle invalide e genera un changelog tecnico.
"""

from typing import Any, Tuple, List, Optional
from ..models import Proposal, Block, TextBlock, ChangelogItemBlock
from ..github_toolset import GitHubToolset
from ._base import load_prompt_template, render_prompt

class ChangelogLoader:
    """Carica le issue di GitHub via Facade e applica il cancello di qualità (Sezione 10.3)."""
    
    async def load(self, context_ref: Any, toolset: GitHubToolset) -> dict:
        owner = context_ref.repoOwner
        repo = context_ref.repoName
        sprint_id = getattr(context_ref, "sprint_id", "Current Sprint")
        
        # Chiediamo le issue chiuse al backend (filtro fittizio per il PoC)
        issues_response = await toolset.read_issues(owner, repo, {"state": "closed"})
        issues = issues_response.get("issues", [])
        
        # Cancello di Qualità (Quality Gate)
        kept_tasks = []
        excluded_tasks = []
        
        for issue in issues:
            issue_milestone = issue.get("milestone")
            if sprint_id != "Sprint Attuale" and issue_milestone != sprint_id:
                continue # Scarta le issue che non appartengono allo sprint richiesto
            
            # Requisito: le storie con descrizione vuota o troppo povera vengono ESCLUSE
            if not issue.get("hasSufficientMetadata", True):
                excluded_tasks.append(f"#{issue.get('number')} {issue.get('title')} (metadati insufficienti)")
            else:
                labels = issue.get('labels', '')
                kept_tasks.append(f"- [#{issue.get('number')}] {issue.get('title')} (Labels: {labels})")

        # Avanzamento
        await toolset.report_progress(stage="changelog_issues_filtered", percent=30)
        
        tasks_formatted = "\n".join(kept_tasks) if kept_tasks else "Nessuna issue valida trovata."
        
        return {
            "sprint_id": sprint_id,
            "tasks_formatted": tasks_formatted,
            "excluded_tasks": excluded_tasks
        }

class ChangelogProfile:
    """Gestisce il prompt e il parsing per l'agente Changelog."""
    agent = "changelog"
    operation = "CHANGELOG_TECHNICAL"
    
    def __init__(self):
        self._ctx = {}

    def build_prompt(self, ctx: dict) -> str:
        self._ctx = ctx
        template_data = load_prompt_template("changelog", "changelog_tech")
        return render_prompt(
            template_data, 
            sprint_id=ctx["sprint_id"], 
            tasks=ctx["tasks_formatted"]
        )

    def parse_output(self, raw: str) -> Tuple[List[Block], Optional[Proposal]]:
        # Per il Changelog, l'output è Markdown libero (come da nostro YAML output_contract)
        blocks: List[Block] = []
        
        # 1. Blocco testo principale generato dall'LLM
        blocks.append(
            TextBlock(
                order=0,
                markdown=raw.strip()
            )
        )
        
        # 2. Aggiungiamo i blocchi delle issue scartate dal cancello di qualità (Trasparenza)
        excluded = self._ctx.get("excluded_tasks", [])
        if excluded:
            for idx, exc in enumerate(excluded):
                blocks.append(
                    ChangelogItemBlock(
                        order=idx + 1,
                        issueRef=exc.split()[0], # Es. "#123"
                        title=exc,
                        detail="Esclusa dal changelog per mancato superamento del cancello di qualità (metadati insufficienti)."
                    )
                )
                
        return blocks, None