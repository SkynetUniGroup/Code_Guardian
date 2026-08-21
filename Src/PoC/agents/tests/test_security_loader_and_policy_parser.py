"""Test di unita' per src/agents/security.py.

test_security_parser.py copre gia' il parsing dell'operazione SECURITY_OWASP:
qui completiamo la copertura con SecurityLoader.load (incluse le diramazioni
di errore) e con il ramo SECURITY_POLICY di SecurityProfile.parse_output,
oltre alle varianti del campo 'remediation'.
"""

import pytest
from types import SimpleNamespace

from src.agents.security import SecurityLoader, SecurityProfile
from src.github_toolset import GitHubToolset
from src.models import PolicyViolationBlock, FindingBlock


class FakeToolset(GitHubToolset):
    """Toolset GitHub finto con risposte in memoria, nessuna rete reale."""

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


def make_context(scope_type="FULL_REPOSITORY", paths=None):
    return SimpleNamespace(
        repoOwner="acme", repoName="demo", ref="sha1",
        scopeType=scope_type, paths=paths or [],
    )


class TestSecurityLoaderLoad:
    @pytest.mark.asyncio
    async def test_load_lists_supported_files_and_default_policy_for_owasp(self):
        nodes = [
            {"path": "src/app.ts", "type": "file"},
            {"path": "README.md", "type": "file"},
        ]
        toolset = FakeToolset(nodes, {})
        loader = SecurityLoader(operation="SECURITY_OWASP")

        ctx = await loader.load(make_context(), toolset)

        assert "src/app.ts" in ctx["files"]
        # README.md non e' un'estensione supportata: non deve comparire nell'elenco
        assert "README.md" not in ctx["files"]
        assert ctx["policy"] == "Nessuna policy specifica fornita. Applica regole OWASP standard."
        assert toolset.progress_calls == [("security_context_loaded", 30)]

    @pytest.mark.asyncio
    async def test_load_raises_value_error_when_no_supported_files_in_scope(self):
        nodes = [{"path": "README.md", "type": "file"}]
        toolset = FakeToolset(nodes, {})
        loader = SecurityLoader(operation="SECURITY_OWASP")

        with pytest.raises(ValueError, match="Nessun file sorgente"):
            await loader.load(make_context(), toolset)

    @pytest.mark.asyncio
    async def test_load_filters_files_by_scope_paths(self):
        nodes = [
            {"path": "src/a.py", "type": "file"},
            {"path": "vendor/b.py", "type": "file"},
        ]
        toolset = FakeToolset(nodes, {})
        loader = SecurityLoader(operation="SECURITY_OWASP")

        ctx = await loader.load(make_context(scope_type="FILES", paths=["src/"]), toolset)

        assert "src/a.py" in ctx["files"]
        assert "vendor/b.py" not in ctx["files"]

    @pytest.mark.asyncio
    async def test_load_raises_value_error_when_policy_scan_missing_policy_file(self):
        nodes = [{"path": "src/app.js", "type": "file"}]
        toolset = FakeToolset(nodes, {})
        loader = SecurityLoader(operation="SECURITY_POLICY")

        with pytest.raises(ValueError, match="POLICY.md non trovato"):
            await loader.load(make_context(), toolset)

    @pytest.mark.asyncio
    async def test_load_reads_policy_file_content_when_present(self):
        nodes = [
            {"path": "src/app.js", "type": "file"},
            {"path": "POLICY.md", "type": "file"},
        ]
        files = {"POLICY.md": "Vietato loggare password in chiaro."}
        toolset = FakeToolset(nodes, files)
        loader = SecurityLoader(operation="SECURITY_POLICY")

        ctx = await loader.load(make_context(), toolset)

        assert ctx["policy"] == "Vietato loggare password in chiaro."


class TestSecurityProfileBuildPrompt:
    def test_build_prompt_selects_owasp_template_for_owasp_operation(self, monkeypatch):
        captured = {}

        def fake_load(agent_name, template_id, version="1.0"):
            captured["template_id"] = template_id
            return {"required_vars": [], "system_prompt": "s", "user_prompt": "u"}

        monkeypatch.setattr("src.agents.security.load_prompt_template", fake_load)
        profile = SecurityProfile(operation="SECURITY_OWASP")

        profile.build_prompt({"policy": "p", "files": "f"})

        assert captured["template_id"] == "owasp_scan"

    def test_build_prompt_selects_policy_template_for_policy_operation(self, monkeypatch):
        captured = {}

        def fake_load(agent_name, template_id, version="1.0"):
            captured["template_id"] = template_id
            return {"required_vars": [], "system_prompt": "s", "user_prompt": "u"}

        monkeypatch.setattr("src.agents.security.load_prompt_template", fake_load)
        profile = SecurityProfile(operation="SECURITY_POLICY")

        profile.build_prompt({"policy": "p", "files": "f"})

        assert captured["template_id"] == "policy_scan"


class TestSecurityProfileParseOutputPolicyBranch:
    """Il ramo SECURITY_OWASP e' gia' testato in test_security_parser.py."""

    def test_parse_output_policy_scan_builds_policy_violation_blocks(self):
        profile = SecurityProfile(operation="SECURITY_POLICY")
        raw = (
            '{"findings": [{"ruleId": "PL-01", "ruleText": "No secrets in logs", '
            '"filePath": "src/log.ts", "explanation": "Password loggata in chiaro", '
            '"remediation": "Rimuovere il log della password"}]}'
        )

        blocks, proposal = profile.parse_output(raw)

        assert proposal is None
        assert len(blocks) == 1
        assert isinstance(blocks[0], PolicyViolationBlock)
        assert blocks[0].ruleId == "PL-01"
        assert blocks[0].filePath == "src/log.ts"
        assert blocks[0].remediation == "Rimuovere il log della password"

    def test_parse_output_policy_scan_defaults_missing_fields(self):
        profile = SecurityProfile(operation="SECURITY_POLICY")
        raw = '{"findings": [{}]}'

        blocks, _ = profile.parse_output(raw)

        assert blocks[0].ruleId == "unknown"
        assert blocks[0].remediation == "Nessuna remediation fornita"


class TestSecurityProfileParseOutputRemediationVariants:
    """TU_09 (PdQ) -- RF.90, RF.91: copre le tre diramazioni di normalizzazione del
    campo 'remediation' nel ramo OWASP: dict 'snippet', dict generico e stringa
    semplice, qualunque sia il formato restituito dal modello LLM."""

    def _raw_with_remediation(self, remediation_value_json: str) -> str:
        return (
            '{"findings": [{"category": "A03", "severity": "high", "file": "a.py", '
            f'"start_line": 1, "end_line": 1, "message": "m", "remediation": {remediation_value_json}}}]}}'
        )

    def test_remediation_snippet_dict_is_wrapped_in_code_fence(self):
        profile = SecurityProfile(operation="SECURITY_OWASP")
        raw = self._raw_with_remediation('{"kind": "snippet", "code": "safe_query()"}')

        blocks, _ = profile.parse_output(raw)

        assert isinstance(blocks[0], FindingBlock)
        assert blocks[0].remediation == "```\nsafe_query()\n```"

    def test_remediation_text_dict_uses_markdown_field(self):
        profile = SecurityProfile(operation="SECURITY_OWASP")
        raw = self._raw_with_remediation('{"kind": "text", "markdown": "Usa query parametrizzate."}')

        blocks, _ = profile.parse_output(raw)

        assert blocks[0].remediation == "Usa query parametrizzate."

    def test_remediation_plain_string_is_used_as_is(self):
        profile = SecurityProfile(operation="SECURITY_OWASP")
        raw = self._raw_with_remediation('"Applica input sanitization"')

        blocks, _ = profile.parse_output(raw)

        assert blocks[0].remediation == "Applica input sanitization"
