"""Lo scheletro condiviso: il grafo a cinque nodi su LangGraph.
Adattato per l'esecuzione asincrona (FastAPI) e per usare la Facade GitHub.
"""
import redis.asyncio as aioredis 
import time
from dataclasses import dataclass, field
from typing import Any, Optional, List, Union

from langgraph.graph import END, START, StateGraph

from .config import settings
from .models import Report, ReportError, Block, Proposal
from .github_toolset import GitHubToolset

import operator
from typing import Annotated, Sequence
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langgraph.prebuilt import ToolNode
from langchain_core.tools import tool

class AgentCancelled(Exception):
    """Eccezione sollevata quando la task viene annullata dall'utente."""
    def __init__(self, stage: str):
        self.stage = stage
        super().__init__(f"Agent cancelled during stage: {stage}")


class AgentTimeout(Exception):
    """Eccezione sollevata quando l'agente supera il tempo massimo totale consentito."""
    def __init__(self, stage: str):
        self.stage = stage
        self.error_type = "TIMEOUT"
        super().__init__(f"Agent global timeout exceeded during stage: {stage}")


@dataclass
class AgentState:
    """Lo stato che scorre attraverso i nodi del grafo LangGraph."""
    user_id: str
    task_id: str
    context_ref: Any
    toolset: GitHubToolset
    tool_rounds: int = 0
    
    loaded_context: Any = None
    prompt: Any = None
    raw_output: Optional[str] = None
    blocks: List[Block] = field(default_factory=list)
    proposal: Optional[Proposal] = None
    
    error: Optional[Exception] = None
    report: Optional[Report] = None
    tokens_consumed: int = 0
    messages: Annotated[List[BaseMessage], operator.add] = field(default_factory=list)

    parse_retries: int = 0
    needs_retry: bool = False


class AgentGraph:
    """Motore di esecuzione LangGraph condiviso da tutti gli agenti."""

    def __init__(
        self,
        loader: Any,
        profile: Any,
        provider: Any,
        timeout_s: int = settings.agent_timeout_s
    ) -> None:
        self._loader = loader
        self._profile = profile
        self._provider = provider
        self._timeout_s = timeout_s
        self._compiled = self._build_graph()

    # -- Costruzione del Grafo --

    def _build_graph(self):
        g = StateGraph(AgentState)

        g.add_node("carica_contesto", self._node_carica_contesto)
        g.add_node("componi_prompt", self._node_componi_prompt)
        g.add_node("invoca_llm", self._node_invoca_llm)
        g.add_node("esegui_tools", self._node_esegui_tools) # NODO AGGIUNTO
        g.add_node("valida_e_parsa", self._node_valida_e_parsa)
        g.add_node("assembla_report", self._node_assembla_report)
        g.add_node("gestisci_errore", self._node_gestisci_errore)

        g.add_edge(START, "carica_contesto")
        g.add_conditional_edges("carica_contesto", self._route, {"continua": "componi_prompt", "errore": "gestisci_errore"})
        g.add_edge("componi_prompt", "invoca_llm")

        # Arco condizionale: il loop vitale dell'agente!
        g.add_conditional_edges(
            "invoca_llm", 
            self._route_llm_output, 
            {"tools": "esegui_tools", "continua": "valida_e_parsa", "errore": "gestisci_errore"}
        )
        
        # Dopo aver eseguito i tool, torna all'LLM per fargli leggere i risultati
        # (a meno che l'esecuzione del tool non sia fallita: in tal caso si va
        # direttamente in errore, senza sprecare un'altra chiamata LLM).
        g.add_conditional_edges("esegui_tools", self._route, {"continua": "invoca_llm", "errore": "gestisci_errore"})
        
        g.add_conditional_edges(
            "valida_e_parsa", 
            self._route_post_valida, 
            {"continua": "assembla_report", "retry": "invoca_llm", "errore": "gestisci_errore"}
        )
        g.add_edge("assembla_report", END)
        g.add_edge("gestisci_errore", END)

        return g.compile()

    def _route_llm_output(self, st: AgentState) -> str:
        if st.error is not None:
            return "errore"

        last_message = st.messages[-1]
        # Se il modello restituisce un messaggio che richiede tool calls, devia sui tool
        if hasattr(last_message, "tool_calls") and len(last_message.tool_calls) > 0:
            max_rounds = getattr(self._profile, "max_tool_rounds", 6)
            if st.tool_rounds >= max_rounds:   # tetto esplicito, fallisce in modo chiaro
                return "errore"
            return "tools"

        return "continua"

    async def _node_invoca_llm(self, st: AgentState) -> dict:
        await self._check_interrupts(st.task_id, self._current_redis_client, "invoca_llm")
        try:
            elapsed = time.monotonic() - self._start_time
            remaining_timeout = max(1, int(self._timeout_s - elapsed))
            
            tools = self._get_langchain_tools(st.toolset, st.context_ref)
            response = await self._provider.invoke_agent(st.messages, tools, remaining_timeout)
            
            new_tokens = 0
            if hasattr(response, "usage_metadata") and response.usage_metadata:
                new_tokens = response.usage_metadata.get("total_tokens", 0)
            elif hasattr(response, "response_metadata") and "token_usage" in response.response_metadata:
                new_tokens = response.response_metadata["token_usage"].get("total_tokens", 0)
            
            raw_out = str(response.content) if not response.tool_calls else None
            
            return {
                "messages": [response], 
                "raw_output": raw_out,
                "tokens_consumed": st.tokens_consumed + new_tokens # Accumuliamo i token totali
            }
        except Exception as exc:
            return {"error": exc}



    async def _node_esegui_tools(self, st):
        await self._check_interrupts(st.task_id, self._current_redis_client, "esegui_tools")
        try:
            tools = self._get_langchain_tools(st.toolset, st.context_ref)
            tool_node = ToolNode(tools)
            result = await tool_node.ainvoke({"messages": st.messages})
            return {"messages": result["messages"], "tool_rounds": st.tool_rounds + 1}
        except Exception as exc:
            return {"error": exc}

    def _get_langchain_tools(self, toolset, context_ref):
        """Espone le chiamate HTTP alla facade come tool annotati per l'LLM."""
        if not getattr(self._profile, "uses_tools", True):
            return []   
        @tool
        async def read_tree() -> dict:
            """Usa questo tool per ottenere l'albero dei file del repository. 
            Esplora le cartelle per capire l'architettura prima di leggere i file."""
            # Prende la sha in automatico da context_ref.ref
            return await toolset.read_tree(context_ref.repoOwner, context_ref.repoName, context_ref.ref)

        @tool
        async def read_file(path: str) -> dict:
            """Usa questo tool per leggere il contenuto sorgente di un singolo file."""
            # Prende la sha in automatico da context_ref.ref
            result = await toolset.read_file(context_ref.repoOwner, context_ref.repoName, context_ref.ref, path)
            
            if "content" in result and isinstance(result["content"], str):
                if len(result["content"]) > settings.max_scope_chars:
                    result["content"] = result["content"][:settings.max_scope_chars] + "\n...[TRONCATO: SUPERATO LIMITE CARATTERI]"
                    
            return result

        @tool
        async def read_issues(state: str = "closed") -> dict:
            """Usa questo tool per leggere i ticket e le issue del progetto."""
            return await toolset.read_issues(context_ref.repoOwner, context_ref.repoName, {"state": state})

        return [read_tree, read_file, read_issues]

    @staticmethod
    def _route(st: AgentState) -> str:
        """Controlla se c'è un'eccezione nello stato per deviare il grafo verso l'errore."""
        return "errore" if st.error is not None else "continua"

    @staticmethod
    def _route_post_valida(st: AgentState) -> str:
        """Smista l'output del parsing: fine, errore, o ritorno all'LLM per correzione."""
        if st.error is not None:
            return "errore"
        if st.needs_retry:
            return "retry"
        return "continua"

    # -- Nodi del Grafo (Asincroni per supportare HTTPX verso NestJS) --

    async def _node_carica_contesto(self, st: AgentState) -> dict:
        await self._check_interrupts(st.task_id, self._current_redis_client, "carica_contesto")
        try:
            ctx = await self._loader.load(st.context_ref, st.toolset)
            return {"loaded_context": ctx}
        except Exception as exc:
            print(f"🔴 ERRORE IN CARICA_CONTESTO: {exc}") 
            return {"error": exc}


    async def _node_componi_prompt(self, st: AgentState) -> dict:
        await self._check_interrupts(st.task_id, self._current_redis_client, "componi_prompt")
        try:
            # Ora riceviamo la tupla (system, user)
            system_prompt, user_prompt = self._profile.build_prompt(st.loaded_context)
            
            # Controllo limiti sul totale dei caratteri inviati
            total_len = len(system_prompt) + len(user_prompt)
            if total_len > settings.max_scope_chars:
                raise ValueError(f"Il contesto d'analisi supera il limite dimensionale ({total_len} > {settings.max_scope_chars} caratteri).")
                
            # Creazione messaggi differenziati
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt)
            ]
                
            return {"prompt": (system_prompt, user_prompt), "messages": messages}
        except Exception as exc:
            print(f"🔴 ERRORE IN COMPONI_PROMPT: {exc}")
            return {"error": exc}

    async def _node_valida_e_parsa(self, st: AgentState) -> dict:
        await self._check_interrupts(st.task_id, self._current_redis_client, "valida_e_parsa")
        try:
            blocks, proposal = self._profile.parse_output(st.raw_output, st.loaded_context)
            # Se ha successo, azzeriamo il flag di retry
            return {"blocks": blocks, "proposal": proposal, "needs_retry": False}
        except Exception as exc:
            from json import JSONDecodeError
            is_parsing_error = isinstance(exc, (JSONDecodeError, ValueError)) or "json" in str(exc).lower() or "parse" in str(exc).lower()
            
            # --- LOGICA DI AUTOCORREZIONE ---
            # Se è un errore di parsing e abbiamo fatto meno di 2 tentativi
            if is_parsing_error and st.parse_retries < 2:
                from langchain_core.messages import AIMessage, HumanMessage
                
                retry_msg = (
                    f"Il tuo output ha generato un errore di decodifica JSON. "
                    f"Correggi la formattazione e restituisci SOLO il JSON valido. "
                    f"Fai attenzione a non inserire testo fuori dalle parentesi graffe e ad usare i corretti caratteri di escape (\\n, \\\").\n\n"
                    f"Dettaglio eccezione del parser:\n{str(exc)}"
                )
                
                # Aggiungiamo alla cronologia sia la risposta sbagliata sia la correzione richiesta
                return {
                    "messages": [
                        AIMessage(content=st.raw_output or ""),
                        HumanMessage(content=retry_msg)
                    ],
                    "parse_retries": st.parse_retries + 1,
                    "needs_retry": True
                }

            # --- FALLIMENTO DEFINITIVO ---
            # Se esauriamo i tentativi o è un errore di altra natura
            if is_parsing_error:
                exc.error_type = "PARSING"
            else:
                exc.error_type = "PARSING" 
            return {"error": exc, "needs_retry": False}

    # -- Nodi Terminali --

    async def _node_assembla_report(self, st: AgentState) -> dict:
        await self._check_interrupts(st.task_id, self._current_redis_client, "assembla_report")
        
        # Generiamo un summary dinamico basato sul tipo di operazione
        op = self._profile.operation
        num_blocks = len(st.blocks)
        
        if op.startswith("SECURITY"):
            summary_text = f"Scansione completata. Trovate {num_blocks} potenziali vulnerabilità o violazioni."
        elif op.startswith("CHANGELOG"):
            summary_text = "Generazione del changelog completata con successo."
            # L'agente changelog restituisce 1 blocco di testo + N blocchi per le issue scartate
            if num_blocks > 1:
                summary_text += f" {num_blocks - 1} issue sono state ignorate per metadati insufficienti."
        elif op.startswith("DOCS"):
            summary_text = "Analisi della documentazione completata."
            if st.proposal:
                summary_text += " È stata generata una proposta di modifica."
        else:
            summary_text = f"Analisi completata. Elaborati {num_blocks} elementi."

        report = Report(
            taskId=st.task_id,
            agentId=self._profile.agent,
            operation=self._profile.operation,
            status="COMPLETED",
            body=st.blocks,
            proposal=st.proposal,
            summary=summary_text,               
            tokensConsumed=st.tokens_consumed   
        )
        return {"report": report}

    async def _node_gestisci_errore(self, st: AgentState) -> dict:
        """Costruisce un report di fallimento, assicurandosi di non violare il contratto DTO."""
        
        # Gestione esplicita per il superamento dei tool rounds (st.error è None)
        if st.error is None:
            max_rounds = getattr(self._profile, "max_tool_rounds", 6)
            error_msg = f"Raggiunto il limite massimo di interazioni con i tool ({max_rounds} round). L'agente non ha fatto in tempo a ispezionare tutti i file."
            error_kind = "TIMEOUT"
            error_repr = "max tool rounds exceeded"
        else:
            error_msg = str(st.error)
            error_kind = getattr(st.error, "error_type", None)
            error_repr = repr(st.error).lower()

        # Mappatura ferrea per intercettare qualsiasi errore di parsing/json
        if "json" in error_msg.lower() or "json" in error_repr or "parse" in error_msg.lower() or "decode" in error_msg.lower():
            error_kind = "PARSING"
        elif "timeout" in error_msg.lower() or "timeout" in error_repr:
            error_kind = "TIMEOUT"
        elif error_kind not in ("TIMEOUT", "PARSING", "UPSTREAM"):
            error_kind = "UPSTREAM"

        if not error_kind:
            error_kind = "UPSTREAM"

        report = Report(
            taskId=st.task_id,
            agentId=self._profile.agent,
            operation=self._profile.operation,
            status="FAILED",
            error=ReportError(kind=error_kind, message=error_msg, stage="agent_execution")
        )
        return {"report": report}

    # -- Metodo Pubblico di Esecuzione --

    async def run(self, task_id: str, user_id: str, context_ref: Any, toolset: GitHubToolset) -> Union[Report, dict]:
        """Avvia la pipeline asincrona per questo agente e ritorna l'oggetto Report o un dict in caso di cancel."""
        self._start_time = time.monotonic()
        t0 = time.monotonic()
        
        initial_state = AgentState(
            user_id=user_id,
            task_id=task_id,
            context_ref=context_ref,
            toolset=toolset
        )
        
        # Inizializza il client Redis una sola volta per l'intera esecuzione 
        self._current_redis_client = aioredis.from_url(settings.redis_url)
        
        try:
            # 'ainvoke' è la versione asincrona per eseguire il grafo
            result = await self._compiled.ainvoke(initial_state)
            report = result["report"]
            report.durationMs = int((time.monotonic() - t0) * 1000)
            return report
            
        except AgentCancelled as ac:
            return {"status": "CANCELLED", "stage": ac.stage}
            
        except AgentTimeout as at:
            report = Report(
                taskId=task_id,
                agentId=self._profile.agent,
                operation=self._profile.operation,
                status="FAILED",
                error=ReportError(kind="TIMEOUT", message=str(at), stage=at.stage)
            )
            report.durationMs = int((time.monotonic() - t0) * 1000)
            return report
            
        except Exception as exc:
            # Fallback assoluto per panici di sistema
            report = Report(
                taskId=task_id,
                agentId=self._profile.agent,
                operation=self._profile.operation,
                status="FAILED",
                error=ReportError(kind="UPSTREAM", message=str(exc), stage="graph_initialization")
            )
            report.durationMs = int((time.monotonic() - t0) * 1000)
            return report
            
        finally:
            # Assicura la chiusura del client Redis al termine dell'agente
            await self._current_redis_client.aclose()
            self._current_redis_client = None

    async def _check_interrupts(self, task_id: str, redis_client: aioredis.Redis, stage: str):
        """Verifica sia il timeout globale (RQ.6) sia se il backend ha richiesto l'annullamento cooperativo."""
        # 1. Controlla il timeout globale
        if time.monotonic() - self._start_time > self._timeout_s:
            raise AgentTimeout(stage=stage)
            
        # 2. Controlla la cancellazione utente
        flag = await redis_client.get(f"cancel:task:{task_id}")
        if flag is not None:
            raise AgentCancelled(stage=stage)