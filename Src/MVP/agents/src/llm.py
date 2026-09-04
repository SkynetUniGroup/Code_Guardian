from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional

from langchain_core.messages import BaseMessage
from langchain_openai import ChatOpenAI

from .config import settings


class LLMProvider(ABC):
    @abstractmethod
    async def invoke_agent(self, messages: list[BaseMessage], tools: list[Any], timeout_s: int) -> BaseMessage:
        pass

    @abstractmethod
    async def complete(self, prompt: str, timeout_s: int) -> str:
        pass


class ManagedAPIProvider(LLMProvider):
    def __init__(self, temperature: Optional[float] = None, max_tokens: Optional[int] = None):
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY non configurata")

        self._llm = ChatOpenAI(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            temperature=temperature if temperature is not None else settings.openai_temperature,
            max_tokens=max_tokens or settings.openai_max_tokens,
        )

    async def invoke_agent(self, messages: list[BaseMessage], tools: list[Any], timeout_s: int) -> BaseMessage:
        llm_with_tools = self._llm.bind_tools(tools) if tools else self._llm
        return await llm_with_tools.ainvoke(messages, timeout=timeout_s)

    async def complete(self, prompt: str, timeout_s: int) -> str:
        from langchain_core.messages import HumanMessage
        response = await self._llm.ainvoke([HumanMessage(content=prompt)], timeout=timeout_s)
        return str(response.content)


def get_llm_provider(temperature: Optional[float] = None, max_tokens: Optional[int] = None) -> LLMProvider:
    return ManagedAPIProvider(temperature=temperature, max_tokens=max_tokens)
