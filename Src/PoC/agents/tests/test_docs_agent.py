"""Test di unita' per src/agents/docs.py (operazione DOCS_INLINE).

Copre:
- l'euristica locale di rilevamento delle unita' non documentate
  (DocsLoader._find_undocumented_units) per Python e per TS/JS;
- il caricamento del contesto (DocsLoader.load) con un toolset GitHub finto,
  senza alcuna chiamata di rete reale;
- il parsing dell'output dell'LLM (DocsProfile.parse_output), incluse le
  diramazioni warning/no-warning e proposal singolo-file/multi-file.
"""

import pytest
from types import SimpleNamespace

from src.agents.docs import DocsLoader, DocsProfile
from src.github_toolset import GitHubToolset


class FakeToolset(GitHubToolset):
    """Toolset GitHub finto, con risposte in memoria per test deterministici."""

    def __init__(self, tree_nodes, files: dict):
        self.user_id = "test_user"
        self.task_id = "test_task"
        self.tree_nodes = tree_nodes
        self.files = files
        self.progress_calls = []

    async def read_tree(self, owner, repo, sha):
        return {"nodes": self.tree_nodes}

    async def read_file(self, owner, repo, sha, path):
        return {"content": self.files.get(path, ""), "path": path}

    async def report_progress(self, stage, percent):
        self.progress_calls.append((stage, percent))


class TestFindUndocumentedUnits:
    """Copre l'euristica statica per Python e per TS/JS."""

    def test_python_function_without_docstring_is_flagged(self):
        loader = DocsLoader()
        content = "def calcola(x):\n    return x * 2\n"

        result = loader._find_undocumented_units(content, "src/util.py")

        assert len(result) == 1
        assert "calcola" in result[0]

    def test_python_function_with_docstring_is_not_flagged(self):
        loader = DocsLoader()
        content = 'def calcola(x):\n    """Raddoppia il valore."""\n    return x * 2\n'

        result = loader._find_undocumented_units(content, "src/util.py")

        assert result == []

    def test_python_class_without_docstring_is_flagged(self):
        loader = DocsLoader()
        content = "class Utente:\n    pass\n"

        result = loader._find_undocumented_units(content, "src/models.py")

        assert any("Utente" in u for u in result)

    def test_typescript_function_without_leading_comment_is_flagged(self):
        loader = DocsLoader()
        content = "function calcola(x) {\n  return x * 2;\n}\n"

        result = loader._find_undocumented_units(content, "src/util.ts")

        assert len(result) == 1
        assert "calcola" in result[0]

    def test_typescript_function_with_leading_line_comment_is_not_flagged(self):
        loader = DocsLoader()
        content = "// Raddoppia il valore\nfunction calcola(x) {\n  return x * 2;\n}\n"

        result = loader._find_undocumented_units(content, "src/util.ts")

        assert result == []

    def test_typescript_arrow_const_without_comment_is_flagged(self):
        loader = DocsLoader()
        content = "const calcola = (x) => {\n  return x * 2;\n};\n"

        result = loader._find_undocumented_units(content, "src/util.ts")

        assert len(result) == 1


class TestDocsLoaderLoad:
    """Copre il flusso completo di caricamento contesto per l'agente Docs."""

    @pytest.mark.asyncio
    async def test_load_collects_package_json_readme_and_undocumented_code(self):
        nodes = [
            {"path": "package.json", "type": "file"},
            {"path": "README.md", "type": "file"},
            {"path": "src/util.ts", "type": "file"},
        ]
        files = {
            "package.json": '{"name": "demo"}',
            "README.md": "# Demo",
            "src/util.ts": "function calcola(x) {\n  return x * 2;\n}\n",
        }
        toolset = FakeToolset(nodes, files)
        loader = DocsLoader()
        context_ref = SimpleNamespace(
            repoOwner="acme", repoName="demo", ref="sha1",
            scopeType="FULL_REPOSITORY", paths=[],
        )

        ctx = await loader.load(context_ref, toolset)

        assert ctx["package_json"] == '{"name": "demo"}'
        assert ctx["readme"] == "# Demo"
        assert "src/util.ts" in ctx["code_units"]
        assert "calcola" in ctx["code_units"]
        # Segnala l'avanzamento alla UI (report_progress) come da contratto
        assert toolset.progress_calls == [("docs_context_loaded", 30)]

    @pytest.mark.asyncio
    async def test_load_reports_no_undocumented_units_when_all_code_is_documented(self):
        nodes = [{"path": "src/util.py", "type": "file"}]
        files = {"src/util.py": 'def calcola(x):\n    """Raddoppia."""\n    return x * 2\n'}
        toolset = FakeToolset(nodes, files)
        loader = DocsLoader()
        context_ref = SimpleNamespace(
            repoOwner="acme", repoName="demo", ref="sha1",
            scopeType="FULL_REPOSITORY", paths=[],
        )

        ctx = await loader.load(context_ref, toolset)

        assert "Nessuna unita' di codice priva di documentazione" in ctx["code_units"]

    @pytest.mark.asyncio
    async def test_load_filters_files_by_scope_paths_when_not_full_repository(self):
        nodes = [
            {"path": "src/a.ts", "type": "file"},
            {"path": "docs/b.ts", "type": "file"},
        ]
        files = {
            "src/a.ts": "function foo() {}\n",
            "docs/b.ts": "function bar() {}\n",
        }
        toolset = FakeToolset(nodes, files)
        loader = DocsLoader()
        context_ref = SimpleNamespace(
            repoOwner="acme", repoName="demo", ref="sha1",
            scopeType="DIRECTORIES", paths=["src/"],
        )

        ctx = await loader.load(context_ref, toolset)

        assert "src/a.ts" in ctx["code_units"]
        assert "docs/b.ts" not in ctx["code_units"]


class TestDocsProfileParseOutput:
    """Copre il parsing dell'output dell'LLM per l'agente Docs."""

    def test_parse_output_with_only_warnings_returns_no_proposal(self):
        profile = DocsProfile()
        raw = (
            '{"warnings": [{"file": "a.ts", "unit": "foo", "line": 3, '
            '"message": "Troppo complessa"}], "docs": []}'
        )

        blocks, proposal = profile.parse_output(raw)

        assert proposal is None
        assert len(blocks) == 1
        assert "foo" in blocks[0].markdown
        assert "a.ts" in blocks[0].markdown

    def test_parse_output_with_single_file_docs_builds_targeted_proposal(self):
        profile = DocsProfile()
        raw = (
            '{"warnings": [], "docs": [{"file": "src/a.ts", "line": 5, '
            '"doc": "/** Calcola il doppio */"}]}'
        )

        blocks, proposal = profile.parse_output(raw)

        assert blocks == []
        assert proposal is not None
        assert proposal.targetPath == "src/a.ts"
        assert "--- a/src/a.ts" in proposal.diffUnified
        assert "+/** Calcola il doppio */" in proposal.diffUnified

    def test_parse_output_with_multiple_files_uses_multi_file_scope_label(self):
        profile = DocsProfile()
        raw = (
            '{"warnings": [], "docs": ['
            '{"file": "src/a.ts", "line": 1, "doc": "doc a"},'
            '{"file": "src/b.ts", "line": 2, "doc": "doc b"}'
            "]}"
        )

        blocks, proposal = profile.parse_output(raw)

        assert proposal.targetPath == "Multi-file scope"
        assert "--- a/src/a.ts" in proposal.diffUnified
        assert "--- a/src/b.ts" in proposal.diffUnified

    def test_parse_output_with_no_warnings_and_no_docs_returns_empty_result(self):
        profile = DocsProfile()
        raw = '{"warnings": [], "docs": []}'

        blocks, proposal = profile.parse_output(raw)

        assert blocks == []
        assert proposal is None
