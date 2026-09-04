from __future__ import annotations

from typing import Any, Optional

from ..github_toolset import GitHubToolset
from ..models import Block, ChangelogItemBlock, Proposal, TextBlock
from ._base import load_prompt_template, render_prompt


class ChangelogLoader:
    async def load(self, context_ref: Any, toolset: GitHubToolset) -> dict:
        owner = context_ref.repoOwner
        repo = context_ref.repoName
        sprint_id = getattr(context_ref, "sprintId", "Sprint Attuale")

        issues_response = await toolset.read_issues(owner, repo, {"state": "closed"})
        issues = issues_response.get("issues", [])

        kept: list[str] = []
        excluded: list[str] = []

        for issue in issues:
            milestone = issue.get("milestone")
            if sprint_id != "Sprint Attuale" and milestone != sprint_id:
                continue

            num = issue.get("number")
            if not issue.get("hasSufficientMetadata", True):
                excluded.append(f"#{num} {issue.get('title', '')} (metadati insufficienti)")
            else:
                labels = issue.get("labels", "")
                url = f"https://github.com/{owner}/{repo}/issues/{num}"
                kept.append(f"- [#{num}]({url}) {issue.get('title', '')} (Labels: {labels})")

        await toolset.report_progress(stage="changelog_issues_filtered", percent=30)

        return {
            "sprint_id": sprint_id,
            "tasks_formatted": "\n".join(kept) if kept else "Nessuna issue valida trovata.",
            "excluded_tasks": excluded,
        }


class ChangelogProfile:
    agent = "changelog"
    operation = "CHANGELOG_TECHNICAL"
    uses_tools = False
    max_tool_rounds = 0

    def __init__(self):
        self._ctx: dict = {}

    def build_prompt(self, ctx: dict) -> tuple[str, str]:
        self._ctx = ctx
        template_data = load_prompt_template("changelog", "changelog_tech")
        return render_prompt(template_data, sprint_id=ctx["sprint_id"], tasks=ctx["tasks_formatted"])

    def parse_output(self, raw: str) -> tuple[list[Block], Optional[Proposal]]:
        blocks: list[Block] = [TextBlock(content=raw.strip())]

        for exc in self._ctx.get("excluded_tasks", []):
            blocks.append(
                ChangelogItemBlock(
                    entry_type="Removed",
                    description=f"Esclusa dal changelog (cancello qualità): {exc}",
                )
            )

        return blocks, None
