from __future__ import annotations

import logging
import operator
import time
from dataclasses import dataclass, field
from typing import Annotated, Any, Optional, Union

import redis.asyncio as aioredis
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from .config import settings
from .github_toolset import GitHubToolset
from .models import Block, Proposal, Report, ReportError

logger = logging.getLogger(__name__)


class AgentCancelled(Exception):
    def __init__(self, stage: str):
        self.stage = stage
        super().__init__(f"Agent cancelled during stage: {stage}")


class AgentTimeout(Exception):
    def __init__(self, stage: str):
        self.stage = stage
        self.error_type = "TIMEOUT"
        super().__init__(f"Agent global timeout exceeded during stage: {stage}")


@dataclass
class AgentState:
    user_id: str
    task_id: str
    context_ref: Any
    toolset: GitHubToolset
    tool_rounds: int = 0
    loaded_context: Any = None
    prompt: Any = None
    raw_output: Optional[str] = None
    blocks: list[Block] = field(default_factory=list)
    proposal: Optional[Proposal] = None
    error: Optional[Exception] = None
    report: Optional[Report] = None
    tokens_consumed: int = 0
    messages: Annotated[list[BaseMessage], operator.add] = field(default_factory=list)
    parse_retries: int = 0
    needs_retry: bool = False


class AgentGraph:
    def __init__(self, loader: Any, profile: Any, provider: Any, timeout_s: int = settings.agent_timeout_s):
        self._loader = loader
        self._profile = profile
        self._provider = provider
        self._timeout_s = timeout_s
        self._start_time: float = 0.0
        self._current_redis_client: Optional[aioredis.Redis] = None
        self._compiled = self._build_graph()

    def _build_graph(self):
        g = StateGraph(AgentState)

        g.add_node("load_context", self._node_load_context)
        g.add_node("build_prompt", self._node_build_prompt)
        g.add_node("invoke_llm", self._node_invoke_llm)
        g.add_node("run_tools", self._node_run_tools)
        g.add_node("validate_parse", self._node_validate_parse)
        g.add_node("assemble_report", self._node_assemble_report)
        g.add_node("handle_error", self._node_handle_error)

        g.add_edge(START, "load_context")
        g.add_conditional_edges("load_context", self._route, {"continue": "build_prompt", "error": "handle_error"})
        g.add_edge("build_prompt", "invoke_llm")
        g.add_conditional_edges(
            "invoke_llm",
            self._route_llm_output,
            {"tools": "run_tools", "continue": "validate_parse", "error": "handle_error"},
        )
        g.add_conditional_edges("run_tools", self._route, {"continue": "invoke_llm", "error": "handle_error"})
        g.add_conditional_edges(
            "validate_parse",
            self._route_post_validate,
            {"continue": "assemble_report", "retry": "invoke_llm", "error": "handle_error"},
        )
        g.add_edge("assemble_report", END)
        g.add_edge("handle_error", END)

        return g.compile()

    def _route_llm_output(self, st: AgentState) -> str:
        if st.error is not None:
            return "error"
        last = st.messages[-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            max_rounds = getattr(self._profile, "max_tool_rounds", settings.max_tool_rounds)
            if st.tool_rounds >= max_rounds:
                return "error"
            return "tools"
        return "continue"

    @staticmethod
    def _route(st: AgentState) -> str:
        return "error" if st.error is not None else "continue"

    @staticmethod
    def _route_post_validate(st: AgentState) -> str:
        if st.error is not None:
            return "error"
        if st.needs_retry:
            return "retry"
        return "continue"

    def _get_langchain_tools(self, toolset: GitHubToolset, context_ref: Any) -> list:
        if not getattr(self._profile, "uses_tools", True):
            return []

        @tool
        async def read_tree() -> dict:
            """Fetch the repository file tree."""
            return await toolset.read_tree(context_ref.repoOwner, context_ref.repoName, context_ref.ref)

        @tool
        async def read_file(path: str) -> dict:
            """Read the content of a single file."""
            result = await toolset.read_file(context_ref.repoOwner, context_ref.repoName, context_ref.ref, path)
            if "content" in result and isinstance(result["content"], str):
                max_chars = 50_000
                if len(result["content"]) > max_chars:
                    result["content"] = result["content"][:max_chars] + "\n...[TRUNCATED]"
            return result

        @tool
        async def read_issues(state: str = "closed") -> dict:
            """Fetch repository issues."""
            return await toolset.read_issues(context_ref.repoOwner, context_ref.repoName, {"state": state})

        return [read_tree, read_file, read_issues]

    async def _check_interrupts(self, task_id: str, redis_client: aioredis.Redis, stage: str) -> None:
        if time.monotonic() - self._start_time > self._timeout_s:
            raise AgentTimeout(stage=stage)
        flag = await redis_client.get(f"cancel:task:{task_id}")
        if flag is not None:
            raise AgentCancelled(stage=stage)

    async def _node_load_context(self, st: AgentState) -> dict:
        await self._check_interrupts(st.task_id, self._current_redis_client, "load_context")
        try:
            ctx = await self._loader.load(st.context_ref, st.toolset)
            return {"loaded_context": ctx}
        except Exception as exc:
            logger.error("Error in load_context: %s", exc)
            return {"error": exc}

    async def _node_build_prompt(self, st: AgentState) -> dict:
        await self._check_interrupts(st.task_id, self._current_redis_client, "build_prompt")
        try:
            system_prompt, user_prompt = self._profile.build_prompt(st.loaded_context)
            messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]
            return {"prompt": (system_prompt, user_prompt), "messages": messages}
        except Exception as exc:
            logger.error("Error in build_prompt: %s", exc)
            return {"error": exc}

    async def _node_invoke_llm(self, st: AgentState) -> dict:
        await self._check_interrupts(st.task_id, self._current_redis_client, "invoke_llm")
        try:
            elapsed = time.monotonic() - self._start_time
            remaining = max(1, int(self._timeout_s - elapsed))
            tools = self._get_langchain_tools(st.toolset, st.context_ref)
            response = await self._provider.invoke_agent(st.messages, tools, remaining)

            new_tokens = 0
            if hasattr(response, "usage_metadata") and response.usage_metadata:
                new_tokens = response.usage_metadata.get("total_tokens", 0)

            raw_out = str(response.content) if not getattr(response, "tool_calls", None) else None
            return {"messages": [response], "raw_output": raw_out, "tokens_consumed": st.tokens_consumed + new_tokens}
        except Exception as exc:
            return {"error": exc}

    async def _node_run_tools(self, st: AgentState) -> dict:
        await self._check_interrupts(st.task_id, self._current_redis_client, "run_tools")
        try:
            tools = self._get_langchain_tools(st.toolset, st.context_ref)
            tool_node = ToolNode(tools)
            result = await tool_node.ainvoke({"messages": st.messages})
            return {"messages": result["messages"], "tool_rounds": st.tool_rounds + 1}
        except Exception as exc:
            return {"error": exc}

    async def _node_validate_parse(self, st: AgentState) -> dict:
        await self._check_interrupts(st.task_id, self._current_redis_client, "validate_parse")
        try:
            blocks, proposal = self._profile.parse_output(st.raw_output)
            return {"blocks": blocks, "proposal": proposal, "needs_retry": False}
        except Exception as exc:
            from json import JSONDecodeError
            from langchain_core.messages import AIMessage

            is_parse = isinstance(exc, (JSONDecodeError, ValueError)) or "json" in str(exc).lower()
            if is_parse and st.parse_retries < 2:
                retry_msg = (
                    f"Your output caused a JSON parsing error. "
                    f"Reply with valid JSON only.\nError: {exc}"
                )
                return {
                    "messages": [AIMessage(content=st.raw_output or ""), HumanMessage(content=retry_msg)],
                    "parse_retries": st.parse_retries + 1,
                    "needs_retry": True,
                }
            exc.error_type = "PARSING"  # type: ignore[attr-defined]
            return {"error": exc, "needs_retry": False}

    async def _node_assemble_report(self, st: AgentState) -> dict:
        await self._check_interrupts(st.task_id, self._current_redis_client, "assemble_report")
        proposal = st.proposal
        if proposal is not None:
            proposal.task_id = st.task_id
            proposal.model = settings.openai_model
            proposal.usage = {"tokens_consumed": st.tokens_consumed}
        report = Report(
            task_id=st.task_id,
            agent_type=self._profile.agent,
            blocks=st.blocks,
            model=settings.openai_model,
            usage={"tokens_consumed": st.tokens_consumed},
            proposal=proposal,
        )
        return {"report": report}

    async def _node_handle_error(self, st: AgentState) -> dict:
        if st.error is None:
            msg = f"Tool rounds limit reached ({settings.max_tool_rounds})."
            kind = "TIMEOUT"
        else:
            msg = str(st.error)
            kind = getattr(st.error, "error_type", None)

        msg_lower = msg.lower()
        if "json" in msg_lower or "parse" in msg_lower or "decode" in msg_lower:
            kind = "PARSING"
        elif "timeout" in msg_lower or "cancel" in msg_lower:
            kind = "TIMEOUT"
        elif kind not in ("TIMEOUT", "PARSING", "UPSTREAM"):
            kind = "UPSTREAM"

        report = ReportError(
            task_id=st.task_id,
            agent_type=self._profile.agent,
            error_kind=kind,
            message=msg,
        )
        return {"report": report}

    async def run(
        self, task_id: str, user_id: str, context_ref: Any, toolset: GitHubToolset
    ) -> Union[Report, ReportError, dict]:
        self._start_time = time.monotonic()
        t0 = self._start_time
        initial_state = AgentState(
            user_id=user_id,
            task_id=task_id,
            context_ref=context_ref,
            toolset=toolset,
        )

        self._current_redis_client = aioredis.from_url(settings.redis_url)
        try:
            result = await self._compiled.ainvoke(initial_state)
            report = result["report"]
            if hasattr(report, "usage"):
                report.usage["duration_ms"] = int((time.monotonic() - t0) * 1000)
            return report
        except AgentCancelled as ac:
            return {"status": "CANCELLED", "stage": ac.stage}
        except AgentTimeout as at:
            return ReportError(
                task_id=task_id,
                agent_type=self._profile.agent,
                error_kind="TIMEOUT",
                message=str(at),
            )
        except Exception as exc:
            logger.exception("Graph panic: %s", exc)
            return ReportError(
                task_id=task_id,
                agent_type=self._profile.agent,
                error_kind="UPSTREAM",
                message=str(exc),
            )
        finally:
            await self._current_redis_client.aclose()
            self._current_redis_client = None
