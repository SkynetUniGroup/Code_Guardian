"""Test di unita' per la logica di instradamento (routing) del grafo
LangGraph in src/graph.py.

Questi test chiamano direttamente i metodi di smistamento e il nodo
'gestisci_errore' su un'istanza di AgentGraph, senza eseguire l'intero
grafo: isolano cosi' la logica decisionale (quale arco condizionale
percorrere) dal resto della pipeline, permettendo di coprire in modo
puntuale e deterministico tutti i rami if/else coinvolti (MPD_8).
"""

import pytest
from langchain_core.messages import AIMessage

from src.graph import AgentGraph, AgentState


class FakeProfile:
    """Profilo minimale: i test di routing non eseguono build_prompt/parse_output."""

    def __init__(self, agent="fake", operation="SECURITY_OWASP", max_tool_rounds=None):
        self.agent = agent
        self.operation = operation
        if max_tool_rounds is not None:
            self.max_tool_rounds = max_tool_rounds


def make_graph(profile=None):
    # loader e provider non vengono mai invocati in questi test: la
    # costruzione del grafo (StateGraph.compile) non li richiama.
    return AgentGraph(loader=object(), profile=profile or FakeProfile(), provider=object())


def make_state(**overrides):
    defaults = dict(user_id="u1", task_id="t1", context_ref=None, toolset=None)
    defaults.update(overrides)
    return AgentState(**defaults)


class TestRouteStaticMethod:
    """Copre AgentGraph._route (usato dopo carica_contesto ed esegui_tools)."""

    def test_route_continues_when_no_error(self):
        state = make_state()
        assert AgentGraph._route(state) == "continua"

    def test_route_goes_to_error_when_error_present(self):
        state = make_state(error=RuntimeError("boom"))
        assert AgentGraph._route(state) == "errore"


class TestRoutePostValida:
    """Copre AgentGraph._route_post_valida (dopo valida_e_parsa)."""

    def test_routes_to_error_when_error_present(self):
        state = make_state(error=ValueError("bad json"), needs_retry=True)
        assert AgentGraph._route_post_valida(state) == "errore"

    def test_routes_to_retry_when_needs_retry_flag_set(self):
        state = make_state(needs_retry=True)
        assert AgentGraph._route_post_valida(state) == "retry"

    def test_routes_to_continua_when_no_error_and_no_retry_needed(self):
        state = make_state(needs_retry=False)
        assert AgentGraph._route_post_valida(state) == "continua"


class TestRouteLlmOutput:
    """Copre AgentGraph._route_llm_output (il cuore del loop tool-calling)."""

    def test_routes_to_error_when_state_has_error(self):
        graph = make_graph()
        state = make_state(error=RuntimeError("x"), messages=[AIMessage(content="ciao")])

        assert graph._route_llm_output(state) == "errore"

    def test_routes_to_continua_when_last_message_has_no_tool_calls(self):
        graph = make_graph()
        state = make_state(messages=[AIMessage(content="risposta finale")])

        assert graph._route_llm_output(state) == "continua"

    def test_routes_to_tools_when_last_message_requests_tool_calls_under_limit(self):
        graph = make_graph(profile=FakeProfile(max_tool_rounds=6))
        msg = AIMessage(content="", tool_calls=[{"name": "read_tree", "args": {}, "id": "1"}])
        state = make_state(messages=[msg], tool_rounds=0)

        assert graph._route_llm_output(state) == "tools"

    def test_routes_to_error_when_tool_round_limit_is_reached(self):
        graph = make_graph(profile=FakeProfile(max_tool_rounds=3))
        msg = AIMessage(content="", tool_calls=[{"name": "read_tree", "args": {}, "id": "1"}])
        state = make_state(messages=[msg], tool_rounds=3)

        assert graph._route_llm_output(state) == "errore"

    def test_uses_default_max_rounds_of_six_when_profile_does_not_define_it(self):
        graph = make_graph(profile=FakeProfile())  # nessun max_tool_rounds esplicito
        msg = AIMessage(content="", tool_calls=[{"name": "read_tree", "args": {}, "id": "1"}])
        state = make_state(messages=[msg], tool_rounds=5)

        assert graph._route_llm_output(state) == "tools"  # 5 < 6 (default)

        state_at_limit = make_state(messages=[msg], tool_rounds=6)
        assert graph._route_llm_output(state_at_limit) == "errore"


class TestNodeGestisciErrore:
    """Copre la classificazione dell'errore (kind) nel nodo terminale di
    fallimento, incluso il caso limite in cui st.error e' None (esaurimento
    dei round di tool)."""

    @pytest.mark.asyncio
    async def test_max_tool_rounds_exhausted_produces_timeout_kind(self):
        graph = make_graph(profile=FakeProfile(max_tool_rounds=4))
        state = make_state(error=None)

        result = await graph._node_gestisci_errore(state)

        report = result["report"]
        assert report.status == "FAILED"
        assert report.error.kind == "TIMEOUT"
        assert "4 round" in report.error.message

    @pytest.mark.asyncio
    async def test_generic_exception_without_error_type_maps_to_upstream(self):
        graph = make_graph()
        state = make_state(error=RuntimeError("connessione rifiutata dal backend"))

        result = await graph._node_gestisci_errore(state)

        assert result["report"].error.kind == "UPSTREAM"

    @pytest.mark.asyncio
    async def test_error_type_parsing_attribute_is_honoured(self):
        graph = make_graph()
        exc = ValueError("json non valido")
        exc.error_type = "PARSING"
        state = make_state(error=exc)

        result = await graph._node_gestisci_errore(state)

        assert result["report"].error.kind == "PARSING"

    @pytest.mark.asyncio
    async def test_message_mentioning_json_is_reclassified_as_parsing_even_without_attribute(self):
        graph = make_graph()
        state = make_state(error=RuntimeError("Impossibile interpretare il JSON restituito"))

        result = await graph._node_gestisci_errore(state)

        assert result["report"].error.kind == "PARSING"

    @pytest.mark.asyncio
    async def test_message_mentioning_timeout_is_classified_as_timeout(self):
        graph = make_graph()
        state = make_state(error=TimeoutError("Timeout di rete verso l'agente"))

        result = await graph._node_gestisci_errore(state)

        assert result["report"].error.kind == "TIMEOUT"

    @pytest.mark.asyncio
    async def test_report_carries_correct_agent_and_operation_from_profile(self):
        graph = make_graph(profile=FakeProfile(agent="security", operation="SECURITY_POLICY"))
        state = make_state(error=RuntimeError("x"))

        result = await graph._node_gestisci_errore(state)

        report = result["report"]
        assert report.agentId == "security"
        assert report.operation == "SECURITY_POLICY"
        assert report.error.stage == "agent_execution"
