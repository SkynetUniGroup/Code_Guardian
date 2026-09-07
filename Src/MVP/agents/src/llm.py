"""LLM Provider (Adapter).

Implements ADR-2: No local model. Uses an OpenAI-compatible managed API (e.g., Qwen)
and provides support for AWS Bedrock (currently disabled due to missing AWS credentials).
"""

from abc import ABC, abstractmethod
from typing import Any, List, Optional

import botocore.exceptions
from langchain_aws import ChatBedrockConverse
from langchain_core.messages import BaseMessage, HumanMessage
from langchain_openai import ChatOpenAI

from .config import settings


class RateLimitError(Exception):
    """Exception mapped to ErrorKind.RATE_LIMITED."""

    def __init__(self, message: str):
        self.error_type = 'RATE_LIMITED'
        super().__init__(message)


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    async def invoke_agent(
        self, messages: List[BaseMessage], tools: List[Any], timeout_s: int
    ) -> BaseMessage:
        """Invokes the model passing the message history and available tools.

        Args:
            messages (List[BaseMessage]): The history of messages.
            tools (List[Any]): The tools available to the model.
            timeout_s (int): The timeout in seconds.

        Returns:
            BaseMessage: The response from the model.
        """
        pass

    @abstractmethod
    async def complete(self, prompt: str, timeout_s: int) -> str:
        """Completes a single text prompt using the model.

        Args:
            prompt (str): The input prompt for the model.
            timeout_s (int): The timeout in seconds.

        Returns:
            str: The raw text response.
        """
        pass


class ManagedAPIProvider(LLMProvider):
    """LLM provider implementation using a managed OpenAI-compatible API."""

    def __init__(
        self,
        model: str,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ):
        api_key = settings.require_llm_key()

        kwargs: dict = {
            'api_key': api_key,
            'base_url': settings.llm_base_url,
            'model': model,
            'max_tokens': max_tokens or settings.max_output_tokens,
        }
        if temperature is not None:
            kwargs['temperature'] = temperature

        self.llm = ChatOpenAI(**kwargs)

    async def invoke_agent(
        self, messages: List[BaseMessage], tools: List[Any], timeout_s: int
    ) -> BaseMessage:
        """Invokes the managed API model with tools and timeout."""
        llm_with_tools = self.llm.bind_tools(tools)
        try:
            return await llm_with_tools.ainvoke(messages, timeout=timeout_s)
        except Exception as exc:
            if 'RateLimitError' in str(type(exc)) or '429' in str(exc):
                raise RateLimitError(f'Managed API rate limit exceeded: {str(exc)}') from exc
            raise

    async def complete(self, prompt: str, timeout_s: int) -> str:
        """Completes a single text prompt using the managed API model."""
        try:
            response = await self.llm.ainvoke([HumanMessage(content=prompt)], timeout=timeout_s)
            return str(response.content)
        except Exception as exc:
            if 'RateLimitError' in str(type(exc)) or '429' in str(exc):
                raise RateLimitError(f'Managed API rate limit exceeded: {str(exc)}') from exc
            raise


class BedrockProvider(LLMProvider):
    """LLM provider implementation using AWS Bedrock."""

    def __init__(
        self,
        model: str,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ):
        kwargs: dict = {
            'region_name': settings.aws_region,
            'model_id': model,
            'max_tokens': max_tokens or settings.max_output_tokens,
        }
        if temperature is not None:
            kwargs['temperature'] = temperature

        self.llm = ChatBedrockConverse(**kwargs)

    async def invoke_agent(
        self, messages: List[BaseMessage], tools: List[Any], timeout_s: int
    ) -> BaseMessage:
        """Invokes the AWS Bedrock model with tools and timeout."""
        llm_with_tools = self.llm.bind_tools(tools) if tools else self.llm
        try:
            # Bedrock handles the timeout at the boto3 internal HTTP client level,
            # but we still pass the configuration to langchain.
            return await llm_with_tools.ainvoke(messages, config={'timeout': timeout_s})
        except Exception as exc:
            self._handle_bedrock_exceptions(exc)

    async def complete(self, prompt: str, timeout_s: int) -> str:
        """Completes a single text prompt using the AWS Bedrock model."""
        try:
            response = await self.llm.ainvoke(
                [HumanMessage(content=prompt)], config={'timeout': timeout_s}
            )
            return str(response.content)
        except Exception as exc:
            self._handle_bedrock_exceptions(exc)

    def _handle_bedrock_exceptions(self, exc: Exception):
        """Intercepts runtime Bedrock exceptions to provide clear application messages."""
        error_msg = str(exc)

        if isinstance(exc, botocore.exceptions.ClientError):
            error_code = exc.response.get('Error', {}).get('Code', 'Unknown')
            if error_code == 'ValidationException' and 'is not supported' in error_msg:
                # Keep existing ValidationException logic
                pass
            elif error_code == 'ThrottlingException':
                raise RateLimitError(f'AWS Bedrock API rate limit exceeded: {error_msg}') from exc

        raise RuntimeError(f'AWS Bedrock invocation failed: {error_msg}') from exc


def get_llm_provider(
    model: str, temperature: Optional[float] = None, max_tokens: Optional[int] = None
) -> LLMProvider:
    """Factory to instantiate the correct provider based on configuration.

    Args:
        model (str): The name or ID of the model to use.
        temperature (Optional[float], optional): The temperature for generation.
        max_tokens (Optional[int], optional): The maximum number of tokens to generate.

    Returns:
        LLMProvider: The instantiated LLM provider.
    """
    if settings.llm_provider.lower() == 'bedrock':
        return BedrockProvider(model=model, temperature=temperature, max_tokens=max_tokens)

    return ManagedAPIProvider(model=model, temperature=temperature, max_tokens=max_tokens)