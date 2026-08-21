"""Test di integrazione per la cattura delle eccezioni a livello di singolo
nodo del Grafo (src/graph.py): un guasto nel loader del contesto, un prompt
che supera il limite dimensionale, o un'eccezione sollevata dal provider LLM
devono sempre tradursi in un Report FAILED codificato, mai risalire come
eccezione non gestita.
"""

import pytest
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace

from src.graph import AgentGraph
from src.llm import LLMProvider
from src.config import settings

FAKE_CONTEXT = SimpleNamespace(repoOwner="acme", repoName="demo", ref="sha1")


class StubProfile:
    agent = "fake-agent"
    operation = "SECURITY_OWASP"
    uses_tools = False

    def build_prompt(self, ctx):
        return ("sys", "usr")

    def parse_output(self, raw, loaded_context=None):
        return [], None


class NeverCalledProvider(LLMProvider):
    async def invoke_agent(self, messages, tools, timeout_s):
        pytest.fail("Il provider LLM non doveva essere invocato: il loader e' fallito prima")


async def run_with_no_interrupts(graph: AgentGraph):
    with patch.object(AgentGraph, "_check_interrupts", new_callable=AsyncMock):
        return await graph.run(task_id="task-1", user_id="user-1", context_ref=FAKE_CONTEXT, toolset=None)


class TestLoaderFailureIsCaught:
    @pytest.mark.asyncio
    async def test_loader_exception_short_circuits_straight_to_a_failed_report(self):
        class FailingLoader:
            async def load(self, context_ref, toolset):
                raise ConnectionError("GitHub non raggiungibile")

        graph = AgentGraph(loader=FailingLoader(), profile=StubProfile(), provider=NeverCalledProvider())

        report = await run_with_no_interrupts(graph)

        assert report.status == "FAILED"
        assert report.error.kind == "UPSTREAM"
        assert "GitHub non raggiungibile" in report.error.message


class TestPromptSizeLimitIsCaught:
    @pytest.mark.asyncio
    async def test_prompt_exceeding_max_scope_chars_produces_failed_report(self):
        # NOTA - COMPORTAMENTO OSSERVATO: l'arco 'componi_prompt' -> 'invoca_llm'
        # e' incondizionato (a differenza di 'carica_contesto', che ha un arco
        # condizionale su _route prima di procedere). Un errore impostato in
        # componi_prompt NON evita quindi che invoca_llm venga comunque
        # eseguito una volta: solo dopo, _route_llm_output rileva l'errore
        # residuo in stato e instrada correttamente verso 'gestisci_errore'.
        # Il risultato finale e' comunque corretto (Report FAILED), ma questo
        # comporta una chiamata LLM di troppo quando il prompt e' gia' invalido:
        # possibile micro-ottimizzazione futura (arco condizionale anche qui).
        class TrivialLoader:
            async def load(self, context_ref, toolset):
                return {}

        class OversizedProfile(StubProfile):
            def build_prompt(self, ctx):
                # Supera deliberatamente settings.max_scope_chars
                oversized = "x" * (settings.max_scope_chars + 10)
                return (oversized, "usr")

        class CountingProvider(LLMProvider):
            def __init__(self):
                self.calls = 0

            async def invoke_agent(self, messages, tools, timeout_s):
                self.calls += 1
                from langchain_core.messages import AIMessage
                return AIMessage(content="non dovrebbe influire sull'esito")

        provider = CountingProvider()
        graph = AgentGraph(loader=TrivialLoader(), profile=OversizedProfile(), provider=provider)

        report = await run_with_no_interrupts(graph)

        assert report.status == "FAILED"
        assert "supera il limite dimensionale" in report.error.message
        # Documenta il comportamento reale: l'LLM viene comunque interpellato
        # una volta prima che l'errore pregresso interrompa il grafo.
        assert provider.calls == 1


class TestLlmProviderExceptionIsCaught:
    @pytest.mark.asyncio
    async def test_provider_exception_is_converted_to_failed_report_not_propagated(self):
        class TrivialLoader:
            async def load(self, context_ref, toolset):
                return {}

        class ExplodingProvider(LLMProvider):
            async def invoke_agent(self, messages, tools, timeout_s):
                raise ConnectionResetError("Connessione al provider LLM interrotta")

        graph = AgentGraph(loader=TrivialLoader(), profile=StubProfile(), provider=ExplodingProvider())

        report = await run_with_no_interrupts(graph)

        assert report.status == "FAILED"
        assert report.error.kind == "UPSTREAM"
        assert "Connessione al provider LLM interrotta" in report.error.message
