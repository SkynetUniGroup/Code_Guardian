"""Test di integrazione per il loop 'invoca_llm' <-> 'esegui_tools' del
Grafo dell'Agente: quando l'LLM richiede tool call, il grafo esegue
realmente i tool esposti dalla Facade GitHub (tramite langgraph ToolNode) e
torna a interpellare l'LLM, fino al tetto esplicito di round configurato dal
profilo. Il superamento del tetto deve tradursi in un esito FAILED
controllato (kind=TIMEOUT), mai in un loop infinito o in un crash.
"""

import pytest
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace

from langchain_core.messages import AIMessage

from src.graph import AgentGraph
from src.llm import LLMProvider
from conftest import MockGitHubToolset

FAKE_CONTEXT = SimpleNamespace(repoOwner="acme", repoName="demo", ref="sha1")


class AlwaysToolCallingProvider(LLMProvider):
    """Simula un LLM che chiede sempre di leggere l'albero dei file, senza
    mai produrre una risposta finale: costringe il grafo a percorrere il
    loop dei tool fino al limite consentito."""

    def __init__(self):
        self.calls = 0

    async def invoke_agent(self, messages, tools, timeout_s):
        self.calls += 1
        return AIMessage(
            content="",
            tool_calls=[{"name": "read_tree", "args": {}, "id": f"call-{self.calls}"}],
        )


class ToolLoopProfile:
    agent = "security"
    operation = "SECURITY_OWASP"
    max_tool_rounds = 2  # basso apposta per mantenere il test rapido

    def build_prompt(self, ctx):
        return ("sistema di test", "utente di test")

    def parse_output(self, raw, loaded_context=None):
        return [], None


class TrivialLoader:
    async def load(self, context_ref, toolset):
        return {}


class TestToolCallingLoopReachesExplicitRoundCap:
    @pytest.mark.asyncio
    async def test_tool_round_cap_produces_controlled_timeout_failure(self):
        provider = AlwaysToolCallingProvider()
        toolset = MockGitHubToolset()
        graph = AgentGraph(loader=TrivialLoader(), profile=ToolLoopProfile(), provider=provider)

        with patch.object(AgentGraph, "_check_interrupts", new_callable=AsyncMock):
            report = await graph.run(
                task_id="task-tools", user_id="user-1",
                context_ref=FAKE_CONTEXT, toolset=toolset,
            )

        assert report.status == "FAILED"
        assert report.error.kind == "TIMEOUT"
        assert "2 round" in report.error.message
        # 1 invocazione iniziale + 1 per ciascun round di tool consentito,
        # + l'invocazione che infine incontra il limite e fallisce.
        assert provider.calls == 3

    @pytest.mark.asyncio
    async def test_llm_final_answer_without_tool_calls_ends_the_loop_immediately(self):
        # Controprova: se l'LLM non richiede alcun tool, il loop non parte
        # affatto e il grafo procede dritto alla validazione dell'output.
        class OneShotProvider(LLMProvider):
            async def invoke_agent(self, messages, tools, timeout_s):
                return AIMessage(content='{"findings": []}')

        toolset = MockGitHubToolset()
        graph = AgentGraph(loader=TrivialLoader(), profile=ToolLoopProfile(), provider=OneShotProvider())

        with patch.object(AgentGraph, "_check_interrupts", new_callable=AsyncMock):
            report = await graph.run(
                task_id="task-tools-2", user_id="user-1",
                context_ref=FAKE_CONTEXT, toolset=toolset,
            )

        assert report.status == "COMPLETED"
        assert report.body == []
