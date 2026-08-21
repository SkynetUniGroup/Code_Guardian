"""Test di integrazione del Grafo dell'Agente (LangGraph).

Verifica due cose che le specifiche richiedono esplicitamente:
1. la SEQUENZA di interazione tra i nodi del grafo: il caricamento del
   contesto (loader) avviene sempre prima dell'invocazione del provider LLM;
2. il percorso nominale (happy path) end-to-end: da AgentGraph.run() a un
   Report COMPLETED, con il testo di sintesi (summary) generato in modo
   diverso a seconda della famiglia di operazione (SECURITY/CHANGELOG/DOCS).

Il provider LLM e' sempre un doppio di test (mai una vera chiamata di rete);
'_check_interrupts' e' patchato a no-op per isolare la sequenza dei nodi dal
comportamento reale di Redis, seguendo lo stesso pattern gia' adottato in
test_cancellation.py e test_graph_errors.py.
"""

import pytest
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace

from langchain_core.messages import AIMessage

from src.graph import AgentGraph
from src.llm import LLMProvider
from src.models import Report, TextBlock, ChangelogItemBlock, Proposal


class RecordingLoader:
    """Registra il momento in cui il contesto viene caricato."""

    def __init__(self, call_order: list, ctx: dict = None):
        self.call_order = call_order
        self.ctx = ctx or {}

    async def load(self, context_ref, toolset):
        self.call_order.append("load_context")
        return self.ctx


class RecordingProvider(LLMProvider):
    """Registra il momento in cui l'LLM viene invocato; risposta fissa e deterministica."""

    def __init__(self, call_order: list, content: str = "risposta llm"):
        self.call_order = call_order
        self.content = content

    async def invoke_agent(self, messages, tools, timeout_s):
        self.call_order.append("invoke_llm")
        return AIMessage(content=self.content)


class FakeProfile:
    """Profilo controllabile: nessuna dipendenza da prompt YAML reali."""

    uses_tools = False

    def __init__(self, agent: str, operation: str, parsed_result):
        self.agent = agent
        self.operation = operation
        self._parsed_result = parsed_result

    def build_prompt(self, ctx):
        return ("system prompt di test", "user prompt di test")

    def parse_output(self, raw, loaded_context=None):
        return self._parsed_result


async def run_graph_with_no_interrupts(graph: AgentGraph, context_ref=None):
    context_ref = context_ref or SimpleNamespace(repoOwner="acme", repoName="demo", ref="sha1")
    with patch.object(AgentGraph, "_check_interrupts", new_callable=AsyncMock):
        return await graph.run(task_id="task-1", user_id="user-1", context_ref=context_ref, toolset=None)


class TestGraphInteractionSequence:
    """Verifica puntuale della sequenza richiesta: carica_contesto -> invoca_llm."""

    @pytest.mark.asyncio
    async def test_context_is_loaded_before_the_llm_provider_is_invoked(self):
        call_order: list = []
        loader = RecordingLoader(call_order)
        provider = RecordingProvider(call_order)
        profile = FakeProfile("fake", "SECURITY_OWASP", ([], None))
        graph = AgentGraph(loader=loader, profile=profile, provider=provider)

        await run_graph_with_no_interrupts(graph)

        assert call_order == ["load_context", "invoke_llm"]

    @pytest.mark.asyncio
    async def test_llm_provider_receives_the_prompt_built_from_the_loaded_context(self):
        received_messages = {}

        class InspectingProvider(LLMProvider):
            async def invoke_agent(self, messages, tools, timeout_s):
                received_messages["messages"] = messages
                return AIMessage(content="ok")

        loader = RecordingLoader([], ctx={"any": "context"})
        profile = FakeProfile("fake", "SECURITY_OWASP", ([], None))
        graph = AgentGraph(loader=loader, profile=profile, provider=InspectingProvider())

        await run_graph_with_no_interrupts(graph)

        system_message, human_message = received_messages["messages"]
        assert system_message.content == "system prompt di test"
        assert human_message.content == "user prompt di test"


class TestHappyPathReportAssembly:
    """Verifica l'assemblaggio del Report COMPLETED e le diramazioni del
    testo di sintesi per ciascuna famiglia di operazione."""

    async def _run(self, operation: str, parsed_result):
        call_order: list = []
        loader = RecordingLoader(call_order)
        provider = RecordingProvider(call_order)
        profile = FakeProfile("fake-agent", operation, parsed_result)
        graph = AgentGraph(loader=loader, profile=profile, provider=provider)
        return await run_graph_with_no_interrupts(graph)

    @pytest.mark.asyncio
    async def test_security_operation_summary_reports_number_of_findings(self):
        report = await self._run("SECURITY_OWASP", ([TextBlock(order=0, markdown="a"),
                                                       TextBlock(order=1, markdown="b")], None))

        assert isinstance(report, Report)
        assert report.status == "COMPLETED"
        assert "Trovate 2 potenziali" in report.summary
        assert report.durationMs >= 0

    @pytest.mark.asyncio
    async def test_changelog_operation_with_single_block_has_plain_summary(self):
        report = await self._run("CHANGELOG_TECHNICAL", ([TextBlock(order=0, markdown="changelog")], None))

        assert report.summary == "Generazione del changelog completata con successo."

    @pytest.mark.asyncio
    async def test_changelog_operation_mentions_excluded_issue_count(self):
        blocks = [
            TextBlock(order=0, markdown="changelog"),
            ChangelogItemBlock(order=1, issueRef="#1", title="t1", detail="d1"),
            ChangelogItemBlock(order=2, issueRef="#2", title="t2", detail="d2"),
        ]
        report = await self._run("CHANGELOG_TECHNICAL", (blocks, None))

        assert "2 issue sono state ignorate" in report.summary

    @pytest.mark.asyncio
    async def test_docs_operation_without_proposal_has_plain_summary(self):
        report = await self._run("DOCS_INLINE", ([], None))

        assert report.summary == "Analisi della documentazione completata."

    @pytest.mark.asyncio
    async def test_docs_operation_with_proposal_mentions_generated_change(self):
        proposal = Proposal(targetPath="src/a.ts", diffUnified="--- a\n+++ b\n", language="typescript")
        report = await self._run("DOCS_INLINE", ([], proposal))

        assert "proposta di modifica" in report.summary
        assert report.proposal.targetPath == "src/a.ts"

    @pytest.mark.asyncio
    async def test_completed_report_carries_agent_id_and_operation_from_profile(self):
        report = await self._run("SECURITY_POLICY", ([], None))

        assert report.agentId == "fake-agent"
        assert report.operation == "SECURITY_POLICY"
        assert report.error is None
