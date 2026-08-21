"""Test di unita' per ManagedAPIProvider (src/llm.py): verifica che i
parametri vengano passati correttamente al client sottostante e che
'invoke_agent'/'complete' orchestrino le chiamate come atteso -- senza MAI
istanziare un vero ChatOpenAI ne' aprire una connessione di rete reale.
'ChatOpenAI' viene sostituito con un doppio di test tramite monkeypatch.
"""

import pytest
from langchain_core.messages import HumanMessage, AIMessage

from src.config import settings as global_settings
from src.llm import ManagedAPIProvider


class FakeChatOpenAI:
    """Doppio di test per langchain_openai.ChatOpenAI: registra i kwargs di
    costruzione e simula bind_tools()/ainvoke() in memoria."""

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.bound_tools = None
        self.last_messages = None
        self.last_timeout = None
        self.response = AIMessage(content="risposta simulata")

    def bind_tools(self, tools):
        self.bound_tools = tools
        return self

    async def ainvoke(self, messages, timeout=None):
        self.last_messages = messages
        self.last_timeout = timeout
        return self.response


@pytest.fixture
def patch_chat_openai(monkeypatch):
    monkeypatch.setattr("src.llm.ChatOpenAI", FakeChatOpenAI)


@pytest.fixture
def patch_api_key(monkeypatch):
    original = global_settings.llm_api_key
    object.__setattr__(global_settings, "llm_api_key", "sk-test-key")
    yield
    object.__setattr__(global_settings, "llm_api_key", original)


class TestManagedAPIProviderConstruction:
    def test_temperature_is_forwarded_only_when_explicitly_provided(self, patch_chat_openai, patch_api_key):
        provider = ManagedAPIProvider(temperature=0.1, max_tokens=500)

        assert provider.llm.kwargs["temperature"] == 0.1
        assert provider.llm.kwargs["max_tokens"] == 500
        assert provider.llm.kwargs["api_key"] == "sk-test-key"

    def test_temperature_is_omitted_by_default_to_preserve_provider_default(self, patch_chat_openai, patch_api_key):
        provider = ManagedAPIProvider()

        assert "temperature" not in provider.llm.kwargs
        assert provider.llm.kwargs["max_tokens"] == global_settings.max_output_tokens

    def test_missing_api_key_prevents_construction(self, patch_chat_openai):
        object.__setattr__(global_settings, "llm_api_key", "")
        try:
            with pytest.raises(RuntimeError, match="LLM_API_KEY"):
                ManagedAPIProvider()
        finally:
            object.__setattr__(global_settings, "llm_api_key", "")


class TestManagedAPIProviderInvocation:
    @pytest.mark.asyncio
    async def test_invoke_agent_binds_tools_then_awaits_ainvoke_with_timeout(self, patch_chat_openai, patch_api_key):
        provider = ManagedAPIProvider()
        messages = [HumanMessage(content="ciao")]
        tools = [object(), object()]

        response = await provider.invoke_agent(messages, tools, timeout_s=45)

        assert response.content == "risposta simulata"
        assert provider.llm.bound_tools == tools
        assert provider.llm.last_messages == messages
        assert provider.llm.last_timeout == 45

    @pytest.mark.asyncio
    async def test_complete_wraps_prompt_in_human_message_and_returns_plain_text(self, patch_chat_openai, patch_api_key):
        provider = ManagedAPIProvider()

        text = await provider.complete("Riassumi il file", timeout_s=20)

        assert text == "risposta simulata"
        assert provider.llm.last_messages[0].content == "Riassumi il file"
        assert provider.llm.last_timeout == 20
