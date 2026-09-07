"""The shared skeleton: the five-node graph on LangGraph.

Adapted for asynchronous execution (FastAPI) and to use the GitHub Facade.
"""

import json
import logging
import operator
import time
from dataclasses import dataclass, field
from typing import Annotated, Any, List, Optional, Union

import redis.asyncio as aioredis
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.errors import GraphInterrupt
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Command, interrupt

from .agents.changelog import ReadabilityTooLowError
from .config import settings
from .github_toolset import GitHubToolset
from .models import Block, ErrorKind, Proposal, Report, ReportError

logger = logging.getLogger(__name__)


class AgentCancelled(Exception):
    """Exception raised when the task is cancelled by the user."""

    def __init__(self, stage: str):
        """Initializes the exception.

        Args:
            stage (str): The stage where the cancellation occurred.
        """
        self.stage = stage
        super().__init__(f'Agent cancelled during stage: {stage}')


class AgentTimeout(Exception):
    """Exception raised when the agent exceeds the maximum allowed total time."""

    def __init__(self, stage: str):
        """Initializes the exception.

        Args:
            stage (str): The stage where the timeout occurred.
        """
        self.stage = stage
        self.error_type = 'TIMEOUT'
        super().__init__(f'Agent global timeout exceeded during stage: {stage}')


class ContextTooLargeError(Exception):
    """Specific exception mapped to ErrorKind.CONTEXT_TOO_LARGE."""

    def __init__(self, message: str):
        """Initializes the exception.

        Args:
            message (str): The error message.
        """
        self.error_type = 'CONTEXT_TOO_LARGE'
        super().__init__(message)


def reduce_messages(existing: List[BaseMessage], new: List[BaseMessage]) -> List[BaseMessage]:
    if new and isinstance(new[0], SystemMessage):
        return new
    return existing + new


@dataclass
class AgentState:
    """Represents the shared state moving through the LangGraph execution nodes."""
    
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
    messages: Annotated[List[BaseMessage], reduce_messages] = field(default_factory=list)
    parse_retries: int = 0
    needs_retry: bool = False
    needs_next_phase: bool = False
    
    agent_payload: dict = field(default_factory=dict)


class AgentGraph:
    """Shared LangGraph execution engine for all agents."""

    def __init__(
        self,
        loader: Any,
        profile: Any,
        provider: Any,
        timeout_s: int = 90,
        checkpointer: Any = None
    ) -> None:
        """Initializes the agent graph.

        Args:
            loader (Any): The context loader adapter.
            profile (Any): The agent profile configuration.
            provider (Any): The LLM provider adapter.
            timeout_s (int, optional): The global timeout in seconds. Defaults to 90.
            checkpointer (Any, optional): The persistence checkpointer. Defaults to None.
        """
        self._loader = loader
        self._profile = profile
        self._provider = provider
        self._timeout_s = timeout_s
        self._start_time = time.monotonic()
        self._compiled = self._build_graph(checkpointer)

    async def execute_step(
        self,
        initial_state: Optional[AgentState] = None,
        resume_command: Optional[Command] = None,
        thread_id: str = 'default'
    ) -> dict:
        """Executes a graph step, handling interrupts for user input.

        Args:
            initial_state (Optional[AgentState], optional): The initial graph state.
            resume_command (Optional[Command], optional): Command to resume the graph.
            thread_id (str, optional): The thread ID for state tracking. Defaults to 'default'.

        Returns:
            dict: The execution result including status, and either a report or pending input.
        """
        config = {'configurable': {'thread_id': thread_id}}
        self._current_redis_client = aioredis.from_url(settings.redis_url)
        
        try:
            if resume_command:
                result = await self._compiled.ainvoke(resume_command, config=config)
            else:
                result = await self._compiled.ainvoke(initial_state, config=config)
                
            report = result.get('report')
            if report:
                return {'status': 'completed', 'result': {'report': report.to_dict()}}
            return {'status': 'failed', 'error': 'Execution completed but report is missing'}

        except GraphInterrupt as e:
            interrupt_value = e.interrupts[0].value
            return {
                'status': 'interrupted',
                'pendingInput': interrupt_value
            }
        except Exception as e:
            return {'status': 'failed', 'error': str(e)}
        finally:
            await self._current_redis_client.aclose()

    def _build_graph(self, checkpointer=None):
        """Builds and compiles the underlying LangGraph.

        Args:
            checkpointer (Any, optional): The persistence checkpoint object. Defaults to None.

        Returns:
            CompiledGraph: The compiled state graph.
        """
        g = StateGraph(AgentState)

        g.add_node('carica_contesto', self._node_carica_contesto)
        g.add_node('componi_prompt', self._node_componi_prompt)
        g.add_node('invoca_llm', self._node_invoca_llm)
        g.add_node('esegui_tools', self._node_esegui_tools)
        g.add_node('valida_e_parsa', self._node_valida_e_parsa)
        g.add_node('await_confirmation', self._node_await_confirmation) 
        g.add_node('assembla_report', self._node_assembla_report)
        g.add_node('gestisci_errore', self._node_gestisci_errore)

        g.add_edge(START, 'carica_contesto')
        g.add_conditional_edges(
            'carica_contesto',
            self._route,
            {'continua': 'componi_prompt', 'errore': 'gestisci_errore'}
        )
        g.add_edge('componi_prompt', 'invoca_llm')

        # Conditional edge: the vital tool loop of the agent
        g.add_conditional_edges(
            'invoca_llm', 
            self._route_llm_output, 
            {'tools': 'esegui_tools', 'continua': 'valida_e_parsa', 'errore': 'gestisci_errore'}
        )
        
        # After tool execution, returns to LLM to process results unless it failed
        g.add_conditional_edges(
            'esegui_tools',
            self._route,
            {'continua': 'invoca_llm', 'errore': 'gestisci_errore'}
        )
        
        g.add_conditional_edges(
            'valida_e_parsa', 
            self._route_post_valida, 
            {
                'continua': 'assembla_report', 
                'retry': 'invoca_llm', 
                'next_phase': 'await_confirmation',
                'errore': 'gestisci_errore'
            }
        )

        g.add_edge('await_confirmation', 'componi_prompt')
        g.add_edge('assembla_report', END)
        g.add_edge('gestisci_errore', END)

        return g.compile(checkpointer=checkpointer)

    def _route_llm_output(self, st: AgentState) -> str:
        """Determines the next step based on the LLM output.

        Args:
            st (AgentState): The current graph state.

        Returns:
            str: The routing decision.
        """
        if st.error is not None:
            return 'errore'

        last_message = st.messages[-1]
        
        # Divert to tools if the model requests tool calls
        if hasattr(last_message, 'tool_calls') and len(last_message.tool_calls) > 0:
            max_rounds = getattr(self._profile, 'max_tool_rounds', 6)
            if st.tool_rounds >= max_rounds:
                return 'errore'
            return 'tools'

        return 'continua'

    async def _node_invoca_llm(self, st: AgentState) -> dict:
        """Invokes the LLM using the designated provider.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update.
        """
        try:
            # Check interrupts inside the try block for proper error routing
            await self._check_interrupts(st.task_id, self._current_redis_client, 'invoca_llm')
            
            elapsed = time.monotonic() - self._start_time
            remaining_timeout = max(1, int(self._timeout_s - elapsed))
            
            tools = self._get_langchain_tools(st.toolset, st.context_ref)
            response = await self._provider.invoke_agent(st.messages, tools, remaining_timeout)
            
            new_tokens = 0
            if hasattr(response, 'usage_metadata') and response.usage_metadata:
                new_tokens = response.usage_metadata.get('total_tokens', 0)
            elif hasattr(response, 'response_metadata'):
                if 'token_usage' in response.response_metadata:
                    new_tokens = response.response_metadata['token_usage'].get('total_tokens', 0)
            
            raw_out = str(response.content) if not response.tool_calls else None
            
            return {
                'messages': [response], 
                'raw_output': raw_out,
                'tokens_consumed': st.tokens_consumed + new_tokens
            }
        except AgentCancelled:
            raise
        except Exception as exc:
            return {'error': exc}
        

    async def _node_esegui_tools(self, st: AgentState) -> dict:
        """Executes the requested tools and appends results to the state.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update.
        """
        try:
            # Check interrupts inside the try block for proper error routing
            await self._check_interrupts(st.task_id, self._current_redis_client, 'esegui_tools')
            tools = self._get_langchain_tools(st.toolset, st.context_ref)
            tool_node = ToolNode(tools)
            result = await tool_node.ainvoke({'messages': st.messages})
            return {'messages': result['messages'], 'tool_rounds': st.tool_rounds + 1}
        except AgentCancelled:
            raise
        except Exception as exc:
            return {'error': exc}

    def _get_langchain_tools(self, toolset: GitHubToolset, context_ref: Any) -> list:
        """Exposes HTTP calls to the facade as annotated tools for the LLM.

        Args:
            toolset (GitHubToolset): The toolset instance to use.
            context_ref (Any): The analysis context.

        Returns:
            list: The list of LangChain compatible tools.
        """
        if not getattr(self._profile, 'uses_tools', True):
            return []
            
        @tool
        async def read_tree() -> dict:
            """Use this tool to get the repository file tree.
            Explore folders to understand the architecture before reading files.
            """
            return await toolset.read_tree(
                context_ref.repoOwner, context_ref.repoName, context_ref.resolvedSha
            )

        @tool
        async def read_file(path: str) -> dict:
            """Use this tool to read the source content of a single file."""
            result = await toolset.read_file(
                context_ref.repoOwner, context_ref.repoName, context_ref.resolvedSha, path
            )
            
            if 'content' in result and isinstance(result['content'], str):
                if len(result['content']) > settings.max_scope_chars:
                    trunc_msg = '\n...[TRUNCATED: CHARACTER LIMIT EXCEEDED]'
                    result['content'] = result['content'][:settings.max_scope_chars] + trunc_msg
                    
            return result

        return [read_tree, read_file]

    @staticmethod
    def _route(st: AgentState) -> str:
        """Checks if an exception is present in the state to divert the graph.

        Args:
            st (AgentState): The current graph state.

        Returns:
            str: The routing decision.
        """
        return 'errore' if st.error is not None else 'continua'

    @staticmethod
    def _route_post_valida(st: AgentState) -> str:
        """Routes the execution after output validation.

        Args:
            st (AgentState): The current graph state.

        Returns:
            str: The routing decision.
        """
        if st.error is not None:
            return 'errore'
        if getattr(st, 'needs_next_phase', False):
            return 'next_phase' 
        if st.needs_retry:
            return 'retry'
        return 'continua'

    # Graph Nodes (Asynchronous to support HTTPX towards NestJS)

    async def _node_carica_contesto(self, st: AgentState) -> dict:
        """Loads the context via the profile's adapter.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update.
        """
        try:
            # Check interrupts inside the try block to ensure timeouts and 
            # cancellations are properly routed to the error handler node
            await self._check_interrupts(st.task_id, self._current_redis_client, 'carica_contesto')
            ctx = await self._loader.load(st.context_ref, st.toolset, st.agent_payload)
            return {'loaded_context': ctx}
        except AgentCancelled:
            raise        
        except Exception as exc:
            logger.error('Error in carica_contesto: %s', exc)
            return {'error': exc}

    async def _node_componi_prompt(self, st: AgentState) -> dict:
        """Composes the system and user prompts.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update containing messages.
        """
        try:
            # Check interrupts inside the try block for proper error routing
            await self._check_interrupts(st.task_id, self._current_redis_client, 'componi_prompt')
            system_prompt, user_prompt = self._profile.build_prompt(st.loaded_context)
            
            total_len = len(system_prompt) + len(user_prompt)
            if total_len > settings.max_scope_chars:
                raise ContextTooLargeError(
                    f'The analysis context exceeds the size limit '
                    f'({total_len} > {settings.max_scope_chars} characters).'
                )
                
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt)
            ]
                
            return {'prompt': (system_prompt, user_prompt), 'messages': messages}
        except AgentCancelled:
            raise
        except Exception as exc:
            logger.error('Error in componi_prompt: %s', exc)
            return {'error': exc}

    async def _node_valida_e_parsa(self, st: AgentState) -> dict:
        """Validates and parses the LLM output, handling specific retries.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update.
        """
        try:
            # Check interrupts inside the try block for proper error routing
            await self._check_interrupts(st.task_id, self._current_redis_client, 'valida_e_parsa')
            ctx = getattr(st, 'loaded_context', {})
            
            result = self._profile.parse_output(st.raw_output, ctx)
            if len(result) == 3:
                blocks, proposal, needs_next_phase = result
            else:
                blocks, proposal = result
                needs_next_phase = False

            all_blocks = st.blocks + blocks if st.blocks else blocks
            
            return {
                'blocks': all_blocks, 
                'proposal': proposal, 
                'needs_retry': False, 
                'needs_next_phase': needs_next_phase,
                'loaded_context': ctx 
            }
        except AgentCancelled:
            raise
        except Exception as exc:
            is_readability_retry = 'READABILITY_RETRY' in str(exc)
            
            is_parsing_error = (
                isinstance(exc, json.JSONDecodeError) or 
                (isinstance(exc, ValueError) and 'json' in str(exc).lower())
            )

            # Readability auto-correction logic
            if is_readability_retry:
                if st.parse_retries < 2:
                    retry_msg = (
                        f'The generated text is too complex or uses jargon. '
                        f'Details: {str(exc)}\n'
                        f'You must simplify the syntax, shorten sentences, '
                        f'and use more accessible language.'
                    )
                    return {
                        'messages': [
                            AIMessage(content=st.raw_output or ''),
                            HumanMessage(content=retry_msg)
                        ],
                        'parse_retries': st.parse_retries + 1,
                        'needs_retry': True
                    }
                else:
                    exc = ReadabilityTooLowError(
                        f'Unable to reach the required readability. {str(exc)}'
                    )
                    return {'error': exc, 'needs_retry': False}

            # JSON auto-correction logic
            if is_parsing_error and st.parse_retries < 2:
                retry_msg = (
                    f'Your output generated a JSON decoding error. '
                    f'Fix the formatting and return ONLY the valid JSON. '
                    f'Pay attention to escape characters.\nDetails: {str(exc)}'
                )
                return {
                    'messages': [
                        AIMessage(content=st.raw_output or ''),
                        HumanMessage(content=retry_msg)
                    ],
                    'parse_retries': st.parse_retries + 1,
                    'needs_retry': True
                }

            # Final failure
            if is_parsing_error:
                exc.error_type = 'PARSING'
            return {'error': exc, 'needs_retry': False}

    async def _node_await_confirmation(self, st: AgentState) -> dict:
        """Suspends execution waiting for human input for the Business phase.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: An empty partial state update.

        Raises:
            AgentCancelled: If the user cancels the confirmation phase.
        """
        action = interrupt({
            'kind': 'BUSINESS_CONFIRMATION',
            'technicalReportId': None
        })

        if action == 'CANCEL':
            raise AgentCancelled(stage='BUSINESS_CONFIRMATION')

        return {}

    async def _node_assembla_report(self, st: AgentState) -> dict:
        """Assembles the final Report DTO.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update containing the report.
        """
        try:
            # Check interrupts inside the try block for proper error routing
            # so that AgentTimeout and AgentCancelled flow into _node_gestisci_errore
            await self._check_interrupts(st.task_id, self._current_redis_client, 'assembla_report')
            
            op = self._profile.operation
            num_blocks = len(st.blocks)
            
            if op.startswith('SECURITY'):
                summary_text = (
                    f'Scan completed. Found {num_blocks} potential vulnerabilities or violations.'
                )
            elif op.startswith('CHANGELOG'):
                summary_text = 'Changelog generation completed successfully.'
                if num_blocks > 1:
                    summary_text += f' {num_blocks - 1} issues were ignored due to insufficient metadata.'
            elif op.startswith('DOCS'):
                summary_text = 'Documentation analysis completed.'
                if st.proposal:
                    summary_text += ' A modification proposal was generated.'
            else:
                summary_text = f'Analysis completed. Processed {num_blocks} elements.'

            ctx = st.context_ref
            report_context = {
                'repoOwner': getattr(ctx, 'repoOwner', 'owner'),
                'repoName': getattr(ctx, 'repoName', 'repo'),
                'repoUrl': getattr(ctx, 'repoUrl', ''),
                'branch': getattr(ctx, 'branch', 'main'),
                'resolvedSha': getattr(ctx, 'resolvedSha', 'HEAD') or 'HEAD',
                'scopeType': getattr(ctx, 'scopeType', 'FULL_REPOSITORY'),
                'paths': getattr(ctx, 'paths', [])
            }

            report = Report(
                taskId=st.task_id,
                agentId=self._profile.agent,
                operation=op,
                status='COMPLETED',
                summary=summary_text,
                context=report_context,
                executionTimeMs=None,
                body=st.blocks,
                proposal=st.proposal,
                tokensConsumed=st.tokens_consumed   
            )
            return {'report': report}
        except AgentCancelled:
            raise
        except Exception as exc:
            return {'error': exc}


    async def _node_gestisci_errore(self, st: AgentState) -> dict:
        """Builds a failure report ensuring it complies with the DTO contract.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update containing the failed report.
        """
        op = self._profile.operation
        ctx = st.context_ref
        
        report_context = {
            'repoOwner': getattr(ctx, 'repoOwner', 'owner'),
            'repoName': getattr(ctx, 'repoName', 'repo'),
            'repoUrl': getattr(ctx, 'repoUrl', ''),
            'branch': getattr(ctx, 'branch', 'main'),
            'resolvedSha': getattr(ctx, 'resolvedSha', 'HEAD') or 'HEAD',
            'scopeType': getattr(ctx, 'scopeType', 'FULL_REPOSITORY'),
            'paths': getattr(ctx, 'paths', [])
        }

        if st.error is None:
            max_rounds = getattr(self._profile, 'max_tool_rounds', 6)
            error_msg = (
                f'Maximum tool interaction limit reached ({max_rounds} rounds). '
                f'The agent did not have time to inspect all files.'
            )
            error_kind = ErrorKind.TIMEOUT
            error_repr = 'max tool rounds exceeded'
        else:
            error_msg = str(st.error)
            error_kind = getattr(st.error, 'error_type', None)
            error_repr = repr(st.error).lower()

        try:
            error_kind = ErrorKind(error_kind) if error_kind else None
        except ValueError:
            error_kind = None

        if error_kind is None:
            if (
                'json' in error_msg.lower() or 
                'json' in error_repr or 
                'parse' in error_msg.lower() or 
                'decode' in error_msg.lower()
            ):
                error_kind = ErrorKind.PARSING
            elif 'timeout' in error_msg.lower() or 'timeout' in error_repr:
                error_kind = ErrorKind.TIMEOUT
            elif (
                'context length' in error_msg.lower() or 
                'maximum context' in error_msg.lower() or 
                'token limit' in error_msg.lower()
            ):
                error_kind = ErrorKind.CONTEXT_TOO_LARGE
            else:
                error_kind = ErrorKind.UPSTREAM

        report = Report(
            taskId=st.task_id,
            agentId=self._profile.agent,
            operation=op,
            status='FAILED',
            context=report_context,
            summary=None,
            executionTimeMs=None,
            error=ReportError(kind=error_kind, message=error_msg, stage='agent_execution')
        )
        return {'report': report}

    async def _check_interrupts(
        self, task_id: str, redis_client: aioredis.Redis, stage: str
    ) -> None:
        """Checks both global timeout and cooperative cancellation requests.

        Args:
            task_id (str): The ID of the task.
            redis_client (aioredis.Redis): The active Redis client.
            stage (str): The current execution stage.

        Raises:
            AgentTimeout: If the execution time exceeds the global timeout.
            AgentCancelled: If the cancellation flag is found in Redis.
        """
        if time.monotonic() - self._start_time > self._timeout_s:
            raise AgentTimeout(stage=stage)
            
        flag = await redis_client.get(f'cancel:task:{task_id}')
        if flag is not None:
            raise AgentCancelled(stage=stage)