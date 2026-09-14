"""The shared skeleton: the five-node graph on LangGraph.

Adapted for asynchronous execution (FastAPI) and to use the GitHub Facade.
"""

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Annotated, Any

import redis.asyncio as aioredis
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.errors import GraphInterrupt
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Command, interrupt

from .agents._base import load_prompt_template
from .config import settings
from .exceptions import ReadabilityTooLowError
from .github_toolset import GitHubToolset
from .models import Block, ErrorKind, Proposal, Report, ReportError

logger = logging.getLogger(__name__)


def resume_action(value: Any) -> str:
    """Normalizes the value with which the graph is resumed.

    The backend resumes a Task by passing 'inputValue = {"action": "PROCEED"}'
    (TasksService.submitInput), while the nodes compared the value against the
    string "CANCEL": a dict is never equal to a string, so an explicit CANCEL
    from the user was read as "proceed". Accepts both forms, so that a manual
    API call with just the string continues to work.

    Args:
        value (Any): The value passed to Command(resume=...).

    Returns:
        str: "PROCEED" or "CANCEL" (defaults to "PROCEED" if not recognized).
    """
    if isinstance(value, dict):
        value = value.get("action")
    return str(value).upper() if value is not None else "PROCEED"


class AgentCancelled(Exception):
    """Exception raised when the task is cancelled by the user."""

    def __init__(self, stage: str):
        """Initializes the exception.

        Args:
            stage (str): The stage where the cancellation occurred.
        """
        self.stage = stage
        super().__init__(f"Agent cancelled during stage: {stage}")


class AgentTimeout(Exception):
    """Exception raised when the agent exceeds the maximum allowed total time."""

    def __init__(self, stage: str):
        """Initializes the exception.

        Args:
            stage (str): The stage where the timeout occurred.
        """
        self.stage = stage
        self.error_type = "TIMEOUT"
        super().__init__(f"Agent global timeout exceeded during stage: {stage}")


class ContextTooLargeError(Exception):
    """Specific exception mapped to ErrorKind.CONTEXT_TOO_LARGE."""

    def __init__(self, message: str):
        """Initializes the exception.

        Args:
            message (str): The error message.
        """
        self.error_type = "CONTEXT_TOO_LARGE"
        super().__init__(message)


def reduce_messages(existing: list[BaseMessage], new: list[BaseMessage]) -> list[BaseMessage]:
    if new and isinstance(new[0], SystemMessage):
        return new
    return existing + new


@dataclass
class AgentState:
    """Represents the shared state moving through the LangGraph execution nodes.

    Note: the toolset is NOT stored here. The state is serialized and written
    to MongoDB by the checkpointer at every step, and GitHubToolset carries
    INTERNAL_SHARED_SECRET: keeping it here would mean pouring the shared
    backend-agents secret into the database at every node traversed, in clear
    text and for every task. The toolset is reconstructible from user_id +
    task_id, which are two identifiers: it is recreated on the fly with
    _toolset() when needed.
    """

    user_id: str
    task_id: str
    context_ref: Any
    tool_rounds: int = 0

    loaded_context: Any = None
    prompt: Any = None
    raw_output: str | None = None
    blocks: list[Block] = field(default_factory=list)
    proposal: Proposal | None = None

    error: Exception | None = None
    report: Report | None = None
    tokens_consumed: int = 0
    messages: Annotated[list[BaseMessage], reduce_messages] = field(default_factory=list)
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
        checkpointer: Any = None,
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

    @staticmethod
    def _toolset(st: AgentState) -> GitHubToolset:
        """Reconstructs the toolset from the state.

        Args:
            st (AgentState): The current graph state.

        Returns:
            GitHubToolset: A toolset for the current user and task.
        """
        return GitHubToolset(user_id=st.user_id, task_id=st.task_id)

    async def execute_step(
        self,
        initial_state: AgentState | None = None,
        resume_command: Command | None = None,
        thread_id: str = "default",
    ) -> dict:
        """Executes a graph step, handling interrupts for user input.

        Args:
            initial_state (Optional[AgentState], optional): The initial graph state.
            resume_command (Optional[Command], optional): Command to resume the graph.
            thread_id (str, optional): The thread ID for state tracking. Defaults to 'default'.

        Returns:
            dict: The execution result including status, and either a report or pending input.
        """
        config = {"configurable": {"thread_id": thread_id}}
        self._current_redis_client = aioredis.from_url(settings.redis_url)

        try:
            if resume_command:
                result = await self._compiled.ainvoke(resume_command, config=config)
            else:
                result = await self._compiled.ainvoke(initial_state, config=config)

            # Since LangGraph 0.2 an interrupt no longer surfaces as an
            # exception: the graph returns normally and puts pending
            # interrupts under the __interrupt__ key. The except GraphInterrupt
            # branch below remains for versions that still raise it.
            pending = self._pending_interrupt(result)
            if pending is not None:
                return {"status": "interrupted", "pendingInput": pending}

            report = result.get("report")
            if report is None:
                return {
                    "status": "failed",
                    "error": "Execution completed but report is missing",
                    "errorKind": ErrorKind.UPSTREAM.value,
                }

            # handle_error still produces a Report, but with status FAILED:
            # without this check a failed run was announced to the backend
            # as "completed", and the ErrorKind computed there reached no one.
            if report.status == "FAILED":
                return {
                    "status": "failed",
                    "error": report.error.message if report.error else "Agent execution failed",
                    "errorKind": (
                        report.error.kind.value if report.error else ErrorKind.UPSTREAM.value
                    ),
                }

            return {"status": "completed", "result": self._run_payload(report)}

        except GraphInterrupt as e:
            interrupt_value = e.interrupts[0].value
            return {"status": "interrupted", "pendingInput": interrupt_value}
        except Exception as e:
            return {"status": "failed", "error": str(e)}
        finally:
            await self._current_redis_client.aclose()

    @staticmethod
    def _pending_interrupt(result: Any) -> Any | None:
        """Extracts the interrupt value from the returned state, if present.

        Args:
            result (Any): The state returned by ainvoke().

        Returns:
            Any | None: The payload of the first pending interrupt, or None.
        """
        if not isinstance(result, dict):
            return None
        interrupts = result.get("__interrupt__")
        if not interrupts:
            return None
        first = interrupts[0] if isinstance(interrupts, (list, tuple)) else interrupts
        return getattr(first, "value", first)

    @staticmethod
    def _run_payload(report: Report) -> dict:
        """Builds the AgentRunPayload expected by the backend.

        Only what the agent alone knows: the blocks, the optional
        modification proposal, the summary and the tokens consumed. Title,
        status, denormalized context and timings are composed by the backend
        in ReportAssemblyService, which has the source data.

        Args:
            report (Report): The report produced by the assemble_report node.

        Returns:
            dict: The payload serialized as JSON.
        """
        payload = report.model_dump(mode="json")
        run_payload = {
            "body": payload.get("body", []),
            "summary": payload.get("summary"),
            "tokensConsumed": payload.get("tokensConsumed", 0),
        }
        # 'proposal' is optional on the backend side (AgentRunPayload.proposal?),
        # not nullable: omit it instead of sending null.
        if payload.get("proposal") is not None:
            run_payload["proposal"] = payload["proposal"]
        return run_payload

    def _build_graph(self, checkpointer=None):
        """Builds and compiles the underlying LangGraph.

        Args:
            checkpointer (Any, optional): The persistence checkpoint object. Defaults to None.

        Returns:
            CompiledGraph: The compiled state graph.
        """
        g = StateGraph(AgentState)

        g.add_node("load_context", self._node_load_context)
        g.add_node("compose_prompt", self._node_compose_prompt)
        g.add_node("invoke_llm", self._node_invoke_llm)
        g.add_node("execute_tools", self._node_execute_tools)
        g.add_node("validate_and_parse", self._node_validate_and_parse)
        g.add_node("await_confirmation", self._node_await_confirmation)
        g.add_node("assemble_report", self._node_assemble_report)
        g.add_node("handle_error", self._node_handle_error)

        g.add_edge(START, "load_context")
        g.add_conditional_edges(
            "load_context",
            self._route,
            {"continue": "compose_prompt", "error": "handle_error"},
        )
        g.add_edge("compose_prompt", "invoke_llm")

        # Conditional edge: the vital tool loop of the agent
        g.add_conditional_edges(
            "invoke_llm",
            self._route_llm_output,
            {
                "tools": "execute_tools",
                "continue": "validate_and_parse",
                "error": "handle_error",
            },
        )

        # After tool execution, returns to LLM to process results unless it failed
        g.add_conditional_edges(
            "execute_tools",
            self._route,
            {"continue": "invoke_llm", "error": "handle_error"},
        )

        g.add_conditional_edges(
            "validate_and_parse",
            self._route_post_validate,
            {
                "continue": "assemble_report",
                "retry": "invoke_llm",
                "next_phase": "await_confirmation",
                "error": "handle_error",
            },
        )

        g.add_edge("await_confirmation", "compose_prompt")
        g.add_edge("assemble_report", END)
        g.add_edge("handle_error", END)

        return g.compile(checkpointer=checkpointer)

    def _route_llm_output(self, st: AgentState) -> str:
        """Determines the next step based on the LLM output.

        Args:
            st (AgentState): The current graph state.

        Returns:
            str: The routing decision.
        """
        if st.error is not None:
            return "error"

        last_message = st.messages[-1]

        # Divert to tools if the model requests tool calls
        if hasattr(last_message, "tool_calls") and len(last_message.tool_calls) > 0:
            max_rounds = getattr(self._profile, "max_tool_rounds", 6)
            if st.tool_rounds >= max_rounds:
                return "error"
            return "tools"

        return "continue"

    async def _node_invoke_llm(self, st: AgentState) -> dict:
        """Invokes the LLM using the designated provider.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update.
        """
        try:
            # If there's already an error from a previous node (e.g., compose_prompt),
            # don't attempt to invoke the LLM - propagate the error directly.
            # This prevents cascading errors like 3230 "Conversation must have at least one message"
            # when messages list is empty due to a prior failure.
            if st.error is not None:
                logger.warning(
                    f"[FIX] Skipping LLM invocation due to prior error in state: {st.error}"
                )
                return {}

            # Check interrupts inside the try block for proper error routing
            await self._check_interrupts(st.task_id, self._current_redis_client, "invoke_llm")

            elapsed = time.monotonic() - self._start_time
            remaining_timeout = max(1, int(self._timeout_s - elapsed))

            tools = self._get_langchain_tools(self._toolset(st), st.context_ref)

            response = await self._provider.invoke_agent(st.messages, tools, remaining_timeout)

            new_tokens = 0
            if hasattr(response, "usage_metadata") and response.usage_metadata:
                new_tokens = response.usage_metadata.get("total_tokens", 0)
            elif hasattr(response, "response_metadata"):
                if "token_usage" in response.response_metadata:
                    new_tokens = response.response_metadata["token_usage"].get("total_tokens", 0)

            raw_out = str(response.content) if not response.tool_calls else None

            return {
                "messages": [response],
                "raw_output": raw_out,
                "tokens_consumed": st.tokens_consumed + new_tokens,
            }
        except AgentCancelled:
            raise
        except Exception as exc:
            return {"error": exc}

    async def _node_execute_tools(self, st: AgentState) -> dict:
        """Executes the requested tools and appends results to the state.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update.
        """
        try:
            # Check interrupts inside the try block for proper error routing
            await self._check_interrupts(st.task_id, self._current_redis_client, "execute_tools")
            tools = self._get_langchain_tools(self._toolset(st), st.context_ref)
            tool_node = ToolNode(tools)
            result = await tool_node.ainvoke({"messages": st.messages})
            return {"messages": result["messages"], "tool_rounds": st.tool_rounds + 1}
        except AgentCancelled:
            raise
        except Exception as exc:
            return {"error": exc}

    def _get_langchain_tools(self, toolset: GitHubToolset, context_ref: Any) -> list:
        """Exposes HTTP calls to the facade as annotated tools for the LLM.

        Args:
            toolset (GitHubToolset): The toolset instance to use.
            context_ref (Any): The analysis context.

        Returns:
            list: The list of LangChain compatible tools.
        """
        if not getattr(self._profile, "uses_tools", True):
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
                context_ref.repoOwner,
                context_ref.repoName,
                context_ref.resolvedSha,
                path,
            )

            if "content" in result and isinstance(result["content"], str):
                if len(result["content"]) > settings.max_scope_chars:
                    trunc_msg = "\n...[TRUNCATED: CHARACTER LIMIT EXCEEDED]"
                    result["content"] = result["content"][: settings.max_scope_chars] + trunc_msg

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
        return "error" if st.error is not None else "continue"

    @staticmethod
    def _route_post_validate(st: AgentState) -> str:
        """Routes the execution after output validation.

        Args:
            st (AgentState): The current graph state.

        Returns:
            str: The routing decision.
        """
        if st.error is not None:
            return "error"
        if getattr(st, "needs_next_phase", False):
            return "next_phase"
        if st.needs_retry:
            return "retry"
        return "continue"

    # Graph Nodes (Asynchronous to support HTTPX towards NestJS)

    async def _node_load_context(self, st: AgentState) -> dict:
        """Loads the context via the profile's adapter.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update.
        """
        try:
            # Check interrupts inside the try block to ensure timeouts and
            # cancellations are properly routed to the error handler node
            await self._check_interrupts(st.task_id, self._current_redis_client, "load_context")
            ctx = await self._loader.load(st.context_ref, self._toolset(st), st.agent_payload)
            return {"loaded_context": ctx}
        except AgentCancelled:
            raise
        except GraphInterrupt:
            # interrupt() signals a pause, not a failure: this is how the
            # Changelog loader asks the user what to do about issues with
            # insufficient metadata. Since GraphInterrupt is an Exception,
            # without this branch it fell into the generic handler below and
            # was turned into {"error": ...}: the graph went to handle_error
            # and the task died with UPSTREAM and the interrupt payload as
            # the message, instead of suspending and waiting for a response.
            # It must propagate intact up to the LangGraph loop, which is the
            # only one that knows how to put it under __interrupt__.
            raise
        except Exception as exc:
            logger.error("Error in load_context: %s", exc)
            return {"error": exc}

    async def _node_compose_prompt(self, st: AgentState) -> dict:
        """Composes the system and user prompts.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update containing messages.
        """
        try:
            # Check interrupts inside the try block for proper error routing
            await self._check_interrupts(st.task_id, self._current_redis_client, "compose_prompt")
            system_prompt, user_prompt = self._profile.build_prompt(st.loaded_context)

            total_len = len(system_prompt) + len(user_prompt)
            if total_len > settings.max_scope_chars:
                raise ContextTooLargeError(
                    f"The analysis context exceeds the size limit "
                    f"({total_len} > {settings.max_scope_chars} characters)."
                )

            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt),
            ]

            return {"prompt": (system_prompt, user_prompt), "messages": messages}
        except AgentCancelled:
            raise
        except Exception as exc:
            logger.error("Error in compose_prompt: %s", exc)
            return {"error": exc}

    async def _node_validate_and_parse(self, st: AgentState) -> dict:
        """Validates and parses the LLM output, handling specific retries.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update.
        """
        try:
            # Check interrupts inside the try block for proper error routing
            await self._check_interrupts(st.task_id, self._current_redis_client, "validate_and_parse")
            ctx = getattr(st, "loaded_context", {})

            result = self._profile.parse_output(st.raw_output, ctx)
            if len(result) == 3:
                blocks, proposal, needs_next_phase = result
            else:
                blocks, proposal = result
                needs_next_phase = False

            all_blocks = st.blocks + blocks if st.blocks else blocks

            return {
                "blocks": all_blocks,
                "proposal": proposal,
                "needs_retry": False,
                "needs_next_phase": needs_next_phase,
                "loaded_context": ctx,
            }
        except AgentCancelled:
            raise
        except Exception as exc:
            is_readability_retry = "READABILITY_RETRY" in str(exc)

            is_parsing_error = isinstance(exc, json.JSONDecodeError) or (
                isinstance(exc, ValueError) and "json" in str(exc).lower()
            )

            # Readability auto-correction logic
            if is_readability_retry:
                if st.parse_retries < 2:
                    # The previous message only said "simplify and shorten",
                    # and the model spun in circles for three attempts always
                    # hovering around thirty. The Flesch index rewards only two
                    # things -- short sentences and short words -- and it pays
                    # to tell it so, with numbers: the same content written in
                    # plain English scores above eighty.
                    # The text lives in prompts/graph/readability_retry.1.0.yaml,
                    # not here: the model reads it, so it is a prompt, and
                    # RQ.4/MPD_14 want prompts outside modules.
                    retry_template = load_prompt_template("graph", "readability_retry")
                    retry_msg = retry_template["system_prompt"].replace(
                        "{details}", str(exc)
                    )
                    return {
                        "messages": [
                            AIMessage(content=st.raw_output or ""),
                            HumanMessage(content=retry_msg),
                        ],
                        "parse_retries": st.parse_retries + 1,
                        "needs_retry": True,
                    }
                else:
                    exc = ReadabilityTooLowError(
                        f"Unable to reach the required readability. {exc!s}"
                    )
                    return {"error": exc, "needs_retry": False}

            # JSON auto-correction logic
            if is_parsing_error and st.parse_retries < 2:
                # This also lives in prompts/graph/, for the same reason as
                # the other: it is text the model reads.
                json_template = load_prompt_template("graph", "json_retry")
                retry_msg = json_template["system_prompt"].replace("{details}", str(exc))
                return {
                    "messages": [
                        AIMessage(content=st.raw_output or ""),
                        HumanMessage(content=retry_msg),
                    ],
                    "parse_retries": st.parse_retries + 1,
                    "needs_retry": True,
                }

            # Final failure
            if is_parsing_error:
                exc.error_type = "PARSING"
            return {"error": exc, "needs_retry": False}

    # How much technical changelog to send to the interface. There is a cap
    # because this text traverses the pendingInput, so it ends up in MongoDB
    # inside the Task and passes through a WebSocket event: it is not the
    # place for an unbounded document. 20k characters are ample for a real
    # sprint.
    _TECHNICAL_PREVIEW_MAX_CHARS = 20_000

    async def _node_await_confirmation(self, st: AgentState) -> dict:
        """Suspends execution waiting for human input for the Business phase.

        Sends the technical changelog just produced to the interface, as text.

        It used to send 'technicalReportId: None', and not by oversight: at
        this point a technical Report **does not exist**. CHANGELOG_BUSINESS
        is a single Task that does two phases inside the same graph
        (await_confirmation returns to compose_prompt), and the Report is
        assembled only at the end, on assemble_report. There was no id to
        send because there was no Report to point to, and the interface
        ended up constructing a link to '/reports/'.

        The text is already there instead: ChangelogBusinessProfile.parse_output
        writes it to ctx["technical_text"] at the end of the technical phase,
        and ctx is st.loaded_context. Sending it directly avoids having to
        invent an intermediate Report on a Task that is still RUNNING.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: An empty partial state update.

        Raises:
            AgentCancelled: If the user cancels the confirmation phase.
        """
        ctx = st.loaded_context or {}
        technical = str(ctx.get("technical_text") or "")
        truncated = len(technical) > self._TECHNICAL_PREVIEW_MAX_CHARS
        if truncated:
            technical = technical[: self._TECHNICAL_PREVIEW_MAX_CHARS]

        action = resume_action(
            interrupt(
                {
                    "kind": "BUSINESS_CONFIRMATION",
                    "technicalChangelog": technical,
                    "technicalChangelogTruncated": truncated,
                }
            )
        )

        if action == "CANCEL":
            raise AgentCancelled(stage="BUSINESS_CONFIRMATION")

        return {}

    async def _node_assemble_report(self, st: AgentState) -> dict:
        """Assembles the final Report DTO.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update containing the report.
        """
        try:
            # Check interrupts inside the try block for proper error routing
            # so that AgentTimeout and AgentCancelled flow into _node_handle_error
            await self._check_interrupts(st.task_id, self._current_redis_client, "assemble_report")

            op = self._profile.operation
            num_blocks = len(st.blocks)

            if op.startswith("SECURITY"):
                summary_text = (
                    f"Scan completed. Found {num_blocks} potential vulnerabilities or violations."
                )
            elif op.startswith("CHANGELOG"):
                summary_text = "Changelog generation completed successfully."
                if num_blocks > 1:
                    summary_text += (
                        f" {num_blocks - 1} issues were ignored due to insufficient metadata."
                    )
            elif op.startswith("DOCS"):
                analysis_status = st.loaded_context.get("analysis_status")

                if analysis_status == "NO_API_ENDPOINTS":
                    summary_text = (
                        "Analysis completed: no API endpoints were detected "
                        "in the analyzed context."
                    )
                elif analysis_status == "NO_DOCUMENTABLE_UNITS":
                    summary_text = (
                        "Analysis completed: no documentable code units "
                        "were detected in the analyzed context."
                    )
                else:
                    summary_text = "Documentation analysis completed."
                    if st.proposal:
                        summary_text += " A modification proposal was generated."
            else:
                summary_text = f"Analysis completed. Processed {num_blocks} elements."

            ctx = st.context_ref
            report_context = {
                "repoOwner": getattr(ctx, "repoOwner", "owner"),
                "repoName": getattr(ctx, "repoName", "repo"),
                "repoUrl": getattr(ctx, "repoUrl", ""),
                "branch": getattr(ctx, "branch", "main"),
                "resolvedSha": getattr(ctx, "resolvedSha", "HEAD") or "HEAD",
                "scopeType": getattr(ctx, "scopeType", "FULL_REPOSITORY"),
                "paths": getattr(ctx, "paths", []),
            }

            report = Report(
                taskId=st.task_id,
                agentId=self._profile.agent,
                operation=op,
                status="COMPLETED",
                summary=summary_text,
                context=report_context,
                executionTimeMs=None,
                body=st.blocks,
                proposal=st.proposal,
                tokensConsumed=st.tokens_consumed,
            )
            return {"report": report}
        except AgentCancelled:
            raise
        except Exception as exc:
            return {"error": exc}

    async def _node_handle_error(self, st: AgentState) -> dict:
        """Builds a failure report ensuring it complies with the DTO contract.

        Args:
            st (AgentState): The current graph state.

        Returns:
            dict: The partial state update containing the failed report.
        """
        op = self._profile.operation
        ctx = st.context_ref

        report_context = {
            "repoOwner": getattr(ctx, "repoOwner", "owner"),
            "repoName": getattr(ctx, "repoName", "repo"),
            "repoUrl": getattr(ctx, "repoUrl", ""),
            "branch": getattr(ctx, "branch", "main"),
            "resolvedSha": getattr(ctx, "resolvedSha", "HEAD") or "HEAD",
            "scopeType": getattr(ctx, "scopeType", "FULL_REPOSITORY"),
            "paths": getattr(ctx, "paths", []),
        }

        if st.error is None:
            max_rounds = getattr(self._profile, "max_tool_rounds", 6)
            error_msg = (
                f"Maximum tool interaction limit reached ({max_rounds} rounds). "
                f"The agent did not have time to inspect all files."
            )
            error_kind = ErrorKind.TIMEOUT
            error_repr = "max tool rounds exceeded"
        else:
            error_msg = str(st.error)
            error_kind = getattr(st.error, "error_type", None)
            error_repr = repr(st.error).lower()

        try:
            error_kind = ErrorKind(error_kind) if error_kind else None
        except ValueError:
            error_kind = None

        if error_kind is None:
            if (
                "json" in error_msg.lower()
                or "json" in error_repr
                or "parse" in error_msg.lower()
                or "decode" in error_msg.lower()
            ):
                error_kind = ErrorKind.PARSING
            elif "timeout" in error_msg.lower() or "timeout" in error_repr:
                error_kind = ErrorKind.TIMEOUT
            elif (
                "context length" in error_msg.lower()
                or "maximum context" in error_msg.lower()
                or "token limit" in error_msg.lower()
            ):
                error_kind = ErrorKind.CONTEXT_TOO_LARGE
            else:
                error_kind = ErrorKind.UPSTREAM

        report_error = ReportError(
            kind=error_kind or ErrorKind.UPSTREAM,
            message=error_msg,
            stage=op,
        )

        report = Report(
            taskId=st.task_id,
            agentId=self._profile.agent,
            operation=op,
            status="FAILED",
            summary=None,
            context=report_context,
            error=report_error,
            body=[],
            tokensConsumed=st.tokens_consumed,
        )
        return {"report": report}
