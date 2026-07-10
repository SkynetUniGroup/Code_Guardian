"""Lo scheletro condiviso: il grafo a cinque nodi, su LangGraph.

Questo modulo e' identico per i tre agenti. Importa SOLO le porte astratte,
mai una classe concreta (inversione delle dipendenze). Grazie a cio' puo'
essere testato con FakeLLMProvider e un profilo fittizio.

Nodi "di lavoro": carica_contesto -> componi_prompt -> invoca_llm ->
valida_e_parsa -> assembla_report.

Rami d'errore: dopo ciascuno dei quattro nodi di lavoro un arco condizionale
controlla `AgentState.error`. Se valorizzato (timeout UC27.2, parse UC27.3,
context_missing), la rotta salta a `gestisci_errore` invece di proseguire: e'
la traduzione nativa LangGraph del try/except che avvolgeva l'intera pipeline
nella versione con il runner interno.

Stato del grafo: e' `AgentState`, la dataclass gia' definita in `ports.py` (non
duplicata qui). LangGraph supporta le dataclass come `state_schema` senza
adattatori. Non usiamo un modello Pydantic per lo stato perche' il campo
`error` porta istanze di eccezione vere (TimeoutErr, ParseError,
ContextMissing, o qualunque eccezione imprevista sollevata da un adapter
esterno): non c'e' nulla da validare o serializzare, e' uno stato di lavoro
interno al grafo, non il contratto dati pubblico (quello resta `Report` in
`models.py`, gia' Pydantic). Una TypedDict non avrebbe aggiunto nulla: avrebbe
solo duplicato i default gia' presenti nella dataclass.

Nota: ogni nodo di lavoro cattura le proprie eccezioni e le scrive in
`AgentState.error`, non le rilancia. E' questo, insieme al bordo esterno in
`run()`, a garantire che `AgentGraph.run()` non sollevi mai.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from langgraph.graph import END, START, StateGraph

from .config import settings
from .errors import AgentError, ContextMissing, ParseError, TimeoutErr
from .models import ErrorInfo, Report
from .ports import AgentProfile, AgentState, ContextLoader, LLMProvider


class AgentGraph:
    """Motore di esecuzione di un agente. Riceve le tre porte per iniezione."""

    def __init__(
        self,
        loader: ContextLoader,
        profile: AgentProfile,
        provider: LLMProvider,
        timeout_s: int | None = None,
    ) -> None:
        self._loader = loader
        self._profile = profile
        self._provider = provider
        self._timeout_s = timeout_s or settings.agent_timeout_s
        self._compiled = self._build_graph()

    # -- costruzione del grafo -----------------------------------------------

    def _build_graph(self):
        g = StateGraph(AgentState)

        g.add_node("carica_contesto", self._node_carica_contesto)
        g.add_node("componi_prompt", self._node_componi_prompt)
        g.add_node("invoca_llm", self._node_invoca_llm)
        g.add_node("valida_e_parsa", self._node_valida_e_parsa)
        g.add_node("assembla_report", self._node_assembla_report)
        g.add_node("gestisci_errore", self._node_gestisci_errore)

        g.add_edge(START, "carica_contesto")
        for nodo, successivo in (
            ("carica_contesto", "componi_prompt"),
            ("componi_prompt", "invoca_llm"),
            ("invoca_llm", "valida_e_parsa"),
            ("valida_e_parsa", "assembla_report"),
        ):
            g.add_conditional_edges(nodo, self._route, {"continua": successivo, "errore": "gestisci_errore"})
        g.add_edge("assembla_report", END)
        g.add_edge("gestisci_errore", END)

        return g.compile()

    @staticmethod
    def _route(st: AgentState) -> str:
        return "errore" if st.error is not None else "continua"

    # -- nodi di lavoro -------------------------------------------------------
    # Ognuno cattura le proprie eccezioni: prima le AgentError (che portano
    # gia' il proprio error_type), poi qualunque altra eccezione imprevista,
    # ricondotta a ParseError. Nessuno dei due casi propaga: entrambi scrivono
    # in `error`, e l'arco condizionale successivo devia a `gestisci_errore`.

    def _node_carica_contesto(self, st: AgentState) -> dict:
        try:
            ctx = self._loader.load(st.context_ref)
            if ctx.is_empty():
                raise ContextMissing(
                    "L'ambito selezionato non contiene alcun contenuto analizzabile."
                )
        except AgentError as exc:
            return {"error": exc}
        except Exception as exc:  # pragma: no cover - adapter esterni imprevisti
            return {"error": ParseError(str(exc))}
        return {"loaded_context": ctx}

    def _node_componi_prompt(self, st: AgentState) -> dict:
        assert st.loaded_context is not None
        try:
            prompt = self._profile.build_prompt(st.loaded_context)
        except AgentError as exc:
            return {"error": exc}
        except Exception as exc:  # pragma: no cover
            return {"error": ParseError(str(exc))}
        return {"prompt": prompt}

    def _node_invoca_llm(self, st: AgentState) -> dict:
        assert st.prompt is not None
        started = time.monotonic()
        try:
            raw = self._provider.complete(st.prompt, timeout_s=self._timeout_s)
            elapsed = time.monotonic() - started
            # Difesa in profondita': anche se il provider non ha rispettato il
            # proprio timeout, il grafo non accetta risposte fuori tempo massimo.
            if elapsed > self._timeout_s:
                raise TimeoutErr(
                    f"Il modello ha risposto in {elapsed:.1f}s, oltre il limite di "
                    f"{self._timeout_s}s."
                )
        except AgentError as exc:
            return {"error": exc}
        except Exception as exc:  # pragma: no cover - rete/IO imprevisti
            return {"error": ParseError(str(exc))}
        return {"raw_output": raw}

    def _node_valida_e_parsa(self, st: AgentState) -> dict:
        assert st.raw_output is not None
        try:
            blocks, proposal = self._profile.parse_output(st.raw_output)
        except AgentError as exc:
            return {"error": exc}
        except Exception as exc:  # pragma: no cover - es. ValidationError di Pydantic
            return {"error": ParseError(str(exc))}
        return {"blocks": blocks, "proposal": proposal}

    # -- nodi terminali ---------------------------------------------------
    # `started_at`/`duration_ms` non fanno parte dello stato: vengono
    # valorizzati da `run()` sul Report finale, cosi' la durata misurata
    # copre l'intera esecuzione del grafo (compresa la costruzione del
    # Report), esattamente come nel runner interno che sostituiscono.

    def _node_assembla_report(self, st: AgentState) -> dict:
        status = "completato"
        # Se l'agente ha prodotto solo segnalazioni di avviso, lo stato lo riflette.
        if any(getattr(b, "category", None) == "avviso" for b in st.blocks):
            status = "avviso"
        report = Report(
            agent=self._profile.agent,  # type: ignore[arg-type]
            operation=self._profile.operation,
            context=st.context_ref,
            status=status,
            blocks=st.blocks,
            proposal=st.proposal,
        )
        return {"report": report}

    def _node_gestisci_errore(self, st: AgentState) -> dict:
        exc = st.error
        error_type = getattr(exc, "error_type", "parse")
        report = Report(
            agent=self._profile.agent,  # type: ignore[arg-type]
            operation=self._profile.operation,
            context=st.context_ref,
            status="fallito",
            blocks=(),
            proposal=None,
            error=ErrorInfo(type=error_type, message=str(exc)),  # type: ignore[arg-type]
        )
        return {"report": report}

    # -- esecuzione ---------------------------------------------------------

    def run(self, ref) -> Report:
        """Esegue la pipeline. Non solleva mai: gli errori finiscono nel Report."""
        started_at = datetime.now(timezone.utc)
        t0 = time.monotonic()

        try:
            result = self._compiled.invoke(AgentState(context_ref=ref))
            report = result["report"]
        except Exception as exc:  # pragma: no cover - difesa: LangGraph non deve mai propagare
            report = Report(
                agent=self._profile.agent,  # type: ignore[arg-type]
                operation=self._profile.operation,
                context=ref,
                status="fallito",
                blocks=(),
                proposal=None,
                error=ErrorInfo(type="parse", message=str(exc)),
            )

        report.started_at = started_at
        report.duration_ms = self._ms(t0)
        return report

    @staticmethod
    def _ms(t0: float) -> int:
        return int((time.monotonic() - t0) * 1000)
