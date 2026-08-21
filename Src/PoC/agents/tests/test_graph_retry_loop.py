"""Test di integrazione per il loop di autocorrezione del parsing in
src/graph.py (nodo 'valida_e_parsa' -> arco 'retry' -> 'invoca_llm').

Quando l'LLM restituisce un output che non supera il parsing, il grafo
richiede fino a due tentativi di correzione prima di dichiarare fallimento
definitivo. Questi test guidano il doppio 'MagicMock' di profilo attraverso
entrambi gli esiti possibili: successo al terzo tentativo e fallimento dopo
aver esaurito i tentativi disponibili.
"""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from langchain_core.messages import AIMessage
from types import SimpleNamespace

from src.graph import AgentGraph
from src.llm import LLMProvider
from src.models import TextBlock

FAKE_CONTEXT = SimpleNamespace(repoOwner="acme", repoName="demo", ref="sha1")


class CountingProvider(LLMProvider):
    """Conta quante volte l'LLM viene invocato: un round per ogni tentativo."""

    def __init__(self):
        self.calls = 0

    async def invoke_agent(self, messages, tools, timeout_s):
        self.calls += 1
        return AIMessage(content=f"risposta grezza tentativo {self.calls}")


class RetryableProfile:
    agent = "fake-agent"
    operation = "SECURITY_OWASP"
    uses_tools = False

    def __init__(self, parse_output_mock):
        self.parse_output = parse_output_mock

    def build_prompt(self, ctx):
        return ("sys", "usr")


class TrivialLoader:
    async def load(self, context_ref, toolset):
        return {}


async def run_with_no_interrupts(graph: AgentGraph):
    with patch.object(AgentGraph, "_check_interrupts", new_callable=AsyncMock):
        return await graph.run(task_id="task-retry", user_id="user-1",
                                context_ref=FAKE_CONTEXT, toolset=None)


class TestParsingRetrySucceedsAfterCorrection:
    @pytest.mark.asyncio
    async def test_third_attempt_succeeds_after_two_failed_parses(self):
        parse_output = MagicMock(side_effect=[
            ValueError("JSON malformato tentativo 1"),
            ValueError("JSON malformato tentativo 2"),
            ([TextBlock(order=0, markdown="ok")], None),
        ])
        provider = CountingProvider()
        graph = AgentGraph(loader=TrivialLoader(), profile=RetryableProfile(parse_output), provider=provider)

        report = await run_with_no_interrupts(graph)

        assert report.status == "COMPLETED"
        assert parse_output.call_count == 3
        assert provider.calls == 3
        assert len(report.body) == 1


class TestParsingRetryExhaustsAttemptsAndFails:
    @pytest.mark.asyncio
    async def test_definitive_failure_after_two_retries_are_exhausted(self):
        parse_output = MagicMock(side_effect=ValueError("sempre JSON malformato"))
        provider = CountingProvider()
        graph = AgentGraph(loader=TrivialLoader(), profile=RetryableProfile(parse_output), provider=provider)

        report = await run_with_no_interrupts(graph)

        assert report.status == "FAILED"
        assert report.error.kind == "PARSING"
        # Due tentativi di correzione + il tentativo che conferma il fallimento definitivo
        assert parse_output.call_count == 3
        assert provider.calls == 3
