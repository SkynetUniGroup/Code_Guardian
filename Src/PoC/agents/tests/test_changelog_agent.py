"""Test di unita' per src/agents/changelog.py (operazione CHANGELOG_TECHNICAL).

Copre il "cancello di qualita'" (Sezione 10.3 delle specifiche) applicato da
ChangelogLoader.load -- filtro per sprint e per metadati sufficienti -- e il
parsing dell'output testuale libero di ChangelogProfile.
"""

import pytest
from types import SimpleNamespace

from src.agents.changelog import ChangelogLoader, ChangelogProfile
from src.models import TextBlock, ChangelogItemBlock
from src.github_toolset import GitHubToolset


class FakeToolset(GitHubToolset):
    """Toolset GitHub finto: restituisce un set di issue fisso, nessuna rete reale."""

    def __init__(self, issues):
        self.user_id = "test_user"
        self.task_id = "test_task"
        self.issues = issues
        self.progress_calls = []

    async def read_issues(self, owner, repo, filter_params=None):
        return {"issues": self.issues}

    async def report_progress(self, stage, percent):
        self.progress_calls.append((stage, percent))


def make_context(sprint_id="Sprint Attuale"):
    return SimpleNamespace(repoOwner="acme", repoName="demo", sprint_id=sprint_id)


class TestChangelogLoaderQualityGate:
    @pytest.mark.asyncio
    async def test_default_sentinel_sprint_keeps_issues_regardless_of_milestone(self):
        issues = [
            {"number": 1, "title": "Fix bug", "milestone": "Sprint 3", "labels": "bug",
             "hasSufficientMetadata": True},
            {"number": 2, "title": "No milestone", "milestone": None, "labels": "",
             "hasSufficientMetadata": True},
        ]
        toolset = FakeToolset(issues)
        loader = ChangelogLoader()

        ctx = await loader.load(make_context(sprint_id="Sprint Attuale"), toolset)

        assert "#1" in ctx["tasks_formatted"]
        assert "#2" in ctx["tasks_formatted"]
        assert ctx["excluded_tasks"] == []
        assert toolset.progress_calls == [("changelog_issues_filtered", 30)]

    @pytest.mark.asyncio
    async def test_explicit_sprint_id_filters_out_issues_from_other_milestones(self):
        issues = [
            {"number": 1, "title": "In sprint", "milestone": "Sprint 5", "labels": "",
             "hasSufficientMetadata": True},
            {"number": 2, "title": "Other sprint", "milestone": "Sprint 4", "labels": "",
             "hasSufficientMetadata": True},
        ]
        toolset = FakeToolset(issues)
        loader = ChangelogLoader()

        ctx = await loader.load(make_context(sprint_id="Sprint 5"), toolset)

        assert "#1" in ctx["tasks_formatted"]
        assert "#2" not in ctx["tasks_formatted"]
        # L'issue #2 e' semplicemente scartata (continue), non finisce tra le escluse
        assert ctx["excluded_tasks"] == []

    @pytest.mark.asyncio
    async def test_issue_with_insufficient_metadata_is_excluded_with_reason(self):
        issues = [
            {"number": 7, "title": "Descrizione vuota", "milestone": None, "labels": "",
             "hasSufficientMetadata": False},
        ]
        toolset = FakeToolset(issues)
        loader = ChangelogLoader()

        ctx = await loader.load(make_context(), toolset)

        assert ctx["tasks_formatted"] == "Nessuna issue valida trovata."
        assert len(ctx["excluded_tasks"]) == 1
        assert "#7" in ctx["excluded_tasks"][0]
        assert "metadati insufficienti" in ctx["excluded_tasks"][0]

    @pytest.mark.asyncio
    async def test_no_issues_returns_placeholder_text(self):
        toolset = FakeToolset([])
        loader = ChangelogLoader()

        ctx = await loader.load(make_context(), toolset)

        assert ctx["tasks_formatted"] == "Nessuna issue valida trovata."
        assert ctx["excluded_tasks"] == []

    @pytest.mark.asyncio
    async def test_kept_issue_is_formatted_as_markdown_link_with_labels(self):
        issues = [
            {"number": 42, "title": "Aggiunto endpoint", "milestone": None,
             "labels": "feature,api", "hasSufficientMetadata": True},
        ]
        toolset = FakeToolset(issues)
        loader = ChangelogLoader()

        ctx = await loader.load(make_context(), toolset)

        assert "[#42](https://github.com/acme/demo/issues/42)" in ctx["tasks_formatted"]
        assert "feature,api" in ctx["tasks_formatted"]


class TestChangelogProfileParseOutput:
    def test_parse_output_wraps_raw_text_in_single_text_block(self):
        profile = ChangelogProfile()
        profile._ctx = {}

        blocks, proposal = profile.parse_output("## Changelog\n- Cosa 1\n- Cosa 2")

        assert proposal is None
        assert len(blocks) == 1
        assert isinstance(blocks[0], TextBlock)
        assert blocks[0].order == 0
        assert blocks[0].markdown == "## Changelog\n- Cosa 1\n- Cosa 2"

    def test_parse_output_trims_surrounding_whitespace_from_raw_text(self):
        profile = ChangelogProfile()
        profile._ctx = {}

        blocks, _ = profile.parse_output("   \n## Changelog\n   ")

        assert blocks[0].markdown == "## Changelog"

    def test_parse_output_appends_excluded_issues_as_changelog_item_blocks(self):
        profile = ChangelogProfile()
        profile._ctx = {"excluded_tasks": [
            "#7 Descrizione vuota (metadati insufficienti)",
            "#9 Altra issue (metadati insufficienti)",
        ]}

        blocks, proposal = profile.parse_output("## Changelog\n- Cosa 1")

        assert proposal is None
        assert len(blocks) == 3
        assert isinstance(blocks[0], TextBlock)
        assert isinstance(blocks[1], ChangelogItemBlock)
        assert blocks[1].issueRef == "#7"
        assert blocks[1].order == 1
        assert blocks[2].issueRef == "#9"
        assert blocks[2].order == 2
        assert "mancato superamento del cancello" in blocks[1].detail
