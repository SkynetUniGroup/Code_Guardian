
"""Provider LLM (Adapter).
Implementa ADR-2: Nessun modello locale. Uso di API gestita compatibile OpenAI (es. Qwen)
e predisposizione per AWS Bedrock (attualmente disabilitato per mancanza di credenziali AWS).
"""

from abc import ABC, abstractmethod
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, BaseMessage
from typing import List, Any

from .config import settings

class LLMProvider(ABC):
    @abstractmethod
    async def invoke_agent(self, messages: List[BaseMessage], tools: List[Any], timeout_s: int) -> BaseMessage:
        """Invoca il modello passandogli lo storico dei messaggi e i tool a disposizione."""
        pass


class ManagedAPIProvider(LLMProvider):
    """Adapter per API gestita (es. DashScope/Qwen) usando l'SDK OpenAI compatibile."""
    
    def __init__(self):
        # Assicura che la chiave esista (lancia RuntimeError altrimenti, come da config.py)
        api_key = settings.require_llm_key()
        
        self.llm = ChatOpenAI(
            api_key=api_key,
            base_url=settings.llm_base_url,
            model=settings.llm_model,
            max_tokens=settings.max_output_tokens
        )

    async def invoke_agent(self, messages: List[BaseMessage], tools: List[Any], timeout_s: int) -> BaseMessage:
        # bind_tools aggancia le definizioni JSON Schema dei tool al modello
        llm_with_tools = self.llm.bind_tools(tools)
        return await llm_with_tools.ainvoke(messages, timeout=timeout_s)
        
    async def complete(self, prompt: str, timeout_s: int) -> str:
        from langchain_core.messages import HumanMessage
        response = await self.llm.ainvoke([HumanMessage(content=prompt)], timeout=timeout_s)
        return str(response.content)


class BedrockProvider(LLMProvider):
    """Adapter per AWS Bedrock.
    Come da ADR-2, è scritto ma non attivabile in questa fase del PoC.
    """
    
    def __init__(self):
        raise NotImplementedError(
            "Credenziali AWS assenti. BedrockProvider non attivabile in questa fase (ADR-2)."
        )
        
    async def complete(self, prompt: str, timeout_s: int) -> tuple[str, int]:
        pass


def get_llm_provider() -> LLMProvider:
    """Factory per istanziare il provider corretto in base alla configurazione."""
    if settings.llm_provider.lower() == "bedrock":
        return BedrockProvider()
    
    # Default su API gestita
    return ManagedAPIProvider()