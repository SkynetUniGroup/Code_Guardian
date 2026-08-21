"""Test di integrazione per la gestione delle eccezioni globali del Grafo
dell'Agente in src/graph.py: superamento del timeout complessivo (RQ.6) e
fallback per errori di sistema non previsti. Verifica che AgentGraph.run()
non propaghi MAI un'eccezione al chiamante, ma la converta sempre in un
Report FAILED con un 'kind' codificato (TIMEOUT/UPSTREAM), cosi' come
richiesto per l'Orchestratore verso i provider LLM esterni.
"""

import pytest
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace

from langchain_core.messages import AIMessage

from src.graph import AgentGraph, AgentTimeout
from src.llm import LLMProvider
from src.models import Report


class NeverCalledLoader:
    """Il loader non deve MAI essere raggiunto: _check_interrupts intercetta
    prima ancora che carica_contesto tenti di caricare alcunche'."""

    async def load(self, context_ref, toolset):
        pytest.fail("Il loader non doveva essere invocato: l'interrupt scatta prima")


class StubProvider(LLMProvider):
    async def invoke_agent(self, messages, tools, timeout_s):
        return AIMessage(content="non dovrebbe mai arrivare qui")


class StubProfile:
    agent = "fake-agent"
    operation = "SECURITY_OWASP"
    uses_tools = False

    def build_prompt(self, ctx):
        return ("sys", "usr")

    def parse_output(self, raw, loaded_context=None):
        return [], None


def make_graph():
    return AgentGraph(loader=NeverCalledLoader(), profile=StubProfile(), provider=StubProvider())


FAKE_CONTEXT = SimpleNamespace(repoOwner="acme", repoName="demo", ref="sha1")


class TestAgentTimeoutHandling:
    """RQ.6: il superamento del tempo massimo complessivo diventa un esito
    codificato (Report FAILED, kind=TIMEOUT), mai un crash o un'eccezione
    che risale fino all'endpoint FastAPI."""

    @pytest.mark.asyncio
    async def test_agent_timeout_is_converted_to_failed_report_with_timeout_kind(self):
        graph = make_graph()

        with patch.object(AgentGraph, "_check_interrupts", new_callable=AsyncMock) as mock_check:
            mock_check.side_effect = AgentTimeout(stage="carica_contesto")

            report = await graph.run(
                task_id="task-timeout", user_id="user-1",
                context_ref=FAKE_CONTEXT, toolset=None,
            )

        assert isinstance(report, Report)
        assert report.status == "FAILED"
        assert report.error.kind == "TIMEOUT"
        assert report.error.stage == "carica_contesto"
        assert report.taskId == "task-timeout"

    @pytest.mark.asyncio
    async def test_agent_timeout_report_carries_a_positive_duration(self):
        graph = make_graph()

        with patch.object(AgentGraph, "_check_interrupts", new_callable=AsyncMock) as mock_check:
            mock_check.side_effect = AgentTimeout(stage="invoca_llm")

            report = await graph.run(
                task_id="task-timeout", user_id="user-1",
                context_ref=FAKE_CONTEXT, toolset=None,
            )

        assert report.durationMs >= 0

    @pytest.mark.asyncio
    async def test_redis_client_reference_is_cleared_after_a_timeout(self):
        # Verifica la corretta chiusura/pulizia della risorsa Redis anche
        # quando la run termina in errore (blocco 'finally' di run()).
        graph = make_graph()

        with patch.object(AgentGraph, "_check_interrupts", new_callable=AsyncMock) as mock_check:
            mock_check.side_effect = AgentTimeout(stage="carica_contesto")
            await graph.run(
                task_id="task-timeout", user_id="user-1",
                context_ref=FAKE_CONTEXT, toolset=None,
            )

        assert graph._current_redis_client is None


class TestUnexpectedSystemErrorFallback:
    """Un'eccezione grezza, non riconducibile ad AgentCancelled/AgentTimeout,
    deve comunque produrre un Report FAILED codificato (kind=UPSTREAM) invece
    di risalire come eccezione non gestita fino al chiamante."""

    @pytest.mark.asyncio
    async def test_unexpected_exception_is_converted_to_upstream_failed_report(self):
        graph = make_graph()

        with patch.object(AgentGraph, "_check_interrupts", new_callable=AsyncMock) as mock_check:
            mock_check.side_effect = RuntimeError("panico di sistema imprevisto")

            report = await graph.run(
                task_id="task-panic", user_id="user-1",
                context_ref=FAKE_CONTEXT, toolset=None,
            )

        assert isinstance(report, Report)
        assert report.status == "FAILED"
        assert report.error.kind == "UPSTREAM"
        assert report.error.stage == "graph_initialization"
        assert "panico di sistema imprevisto" in report.error.message
