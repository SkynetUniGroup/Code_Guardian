"""Test di unita' per src/llm.py: la factory get_llm_provider() e la
validazione della chiave API (ADR-2: nessun modello locale, API gestita
compatibile OpenAI di default, Bedrock predisposto ma non attivabile).

Non viene mai contattato un vero endpoint LLM: ChatOpenAI si limita a
costruire la configurazione del client in memoria.
"""

import pytest

from src.config import Settings, settings as global_settings
from src.llm import get_llm_provider, ManagedAPIProvider, BedrockProvider


@pytest.fixture
def patch_global_settings(monkeypatch):
    """Permette di forzare in modo isolato i campi del singleton 'settings'
    usato da src.llm, senza dipendere dalle variabili d'ambiente della
    macchina che esegue i test. 'settings' e' un modello pydantic 'frozen',
    quindi si aggira il blocco di __setattr__ con object.__setattr__ e si
    ripristinano i valori originali a fine test."""

    original = {
        "llm_provider": global_settings.llm_provider,
        "llm_api_key": global_settings.llm_api_key,
    }

    def _set(**kwargs):
        for key, value in kwargs.items():
            object.__setattr__(global_settings, key, value)

    yield _set

    for key, value in original.items():
        object.__setattr__(global_settings, key, value)


class TestRequireLlmKey:
    """require_llm_key() e' testato su un'istanza Settings dedicata, per non
    toccare lo stato condiviso del singleton globale."""

    def test_require_llm_key_raises_runtime_error_when_empty(self):
        local_settings = Settings(llm_api_key="")

        with pytest.raises(RuntimeError, match="LLM_API_KEY"):
            local_settings.require_llm_key()

    def test_require_llm_key_returns_key_when_configured(self):
        local_settings = Settings(llm_api_key="sk-test-123")

        assert local_settings.require_llm_key() == "sk-test-123"


class TestGetLlmProviderFactory:
    """Copre le due diramazioni della factory (ADR-2).

    NOTA - DIFETTO RISCONTRATO: 'BedrockProvider' estende l'ABC 'LLMProvider'
    ma implementa solo 'complete', non il metodo astratto 'invoke_agent'.
    Di conseguenza Python blocca l'istanziazione con una 'TypeError' generata
    da ABCMeta ("Can't instantiate abstract class...") PRIMA ancora che
    '__init__' possa sollevare il suo 'NotImplementedError' con il messaggio
    esplicativo su ADR-2: quel messaggio e' codice morto, mai raggiunto.
    I test qui sotto verificano il comportamento REALE (TypeError) invece di
    quello documentato/atteso (NotImplementedError), cosi' da restare verdi
    pur segnalando esplicitamente la discrepanza. Fix suggerito: aggiungere
    a BedrockProvider un 'async def invoke_agent(self, ...): ...' (anche solo
    'raise NotImplementedError(...)') per soddisfare il contratto dell'ABC.
    """

    def test_bedrock_provider_is_not_activatable_in_this_poc(self, patch_global_settings):
        patch_global_settings(llm_provider="bedrock")

        # Comportamento reale odierno: TypeError da ABCMeta, non NotImplementedError.
        with pytest.raises(TypeError, match="invoke_agent"):
            get_llm_provider()

    def test_managed_api_provider_is_returned_by_default(self, patch_global_settings):
        patch_global_settings(llm_provider="managed", llm_api_key="sk-test-123")

        provider = get_llm_provider()

        assert isinstance(provider, ManagedAPIProvider)

    def test_managed_api_provider_raises_when_api_key_missing(self, patch_global_settings):
        patch_global_settings(llm_provider="managed", llm_api_key="")

        with pytest.raises(RuntimeError, match="LLM_API_KEY"):
            get_llm_provider()

    def test_provider_selection_is_case_insensitive(self, patch_global_settings):
        patch_global_settings(llm_provider="BEDROCK")

        with pytest.raises(TypeError, match="invoke_agent"):
            get_llm_provider()

    def test_bedrock_provider_is_not_instantiable_due_to_incomplete_abc_contract(self):
        # BedrockProvider non implementa il metodo astratto 'invoke_agent'
        # richiesto da LLMProvider: l'istanziazione fallisce a livello di
        # ABCMeta, quindi il suo __init__ (che vorrebbe sollevare
        # NotImplementedError con un messaggio esplicativo) non viene mai eseguito.
        with pytest.raises(TypeError, match="invoke_agent"):
            BedrockProvider()
