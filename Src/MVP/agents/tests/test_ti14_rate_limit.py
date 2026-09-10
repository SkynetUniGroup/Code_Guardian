"""TI_14 (RQ.8) — la meta' lato agente della catena del rate limit.

RQ.8 chiede che un 429 del provider LLM arrivi all'utente come
``error.code = LLM_RATE_LIMITED`` e che l'esecuzione non resti bloccata in
attesa indefinita. La catena attraversa tre componenti in due linguaggi:

1. il provider traduce il 429 in ``RateLimitError`` (``src/llm.py``);
2. il grafo lo classifica come ``ErrorKind.RATE_LIMITED`` nel report di
   fallimento (``src/graph.py``);
3. il backend traduce ``RATE_LIMITED`` in ``LLM_RATE_LIMITED`` e lo scrive
   sulla task.

Qui stanno i primi due anelli. Il terzo e' in
``backend/test/agent-error-propagation.e2e-spec.ts``, con lo stesso codice
TI_14. Fra il secondo e il terzo c'e' pero' un anello rotto, documentato
dall'xfail in fondo: ``execute_step`` consegna al backend un report di
fallimento con ``status: 'completed'``, quindi il valore RATE_LIMITED
classificato al punto 2 non arriva mai al punto 3.

I doppi deterministici sono quelli di ``test_graph.py``: sono gia' scritti,
gia' usati dalla suite del grafo, e riscriverli qui li farebbe divergere.
"""

import pytest

from src import graph as graph_module
from src import llm as llm_module
from src.llm import RateLimitError, get_llm_provider
from src.models import ErrorKind

from tests.test_graph import FakeProvider, FakeRedis, build_graph, build_state
from tests.test_llm import FakeChatModel, FakeSettings


@pytest.fixture(autouse=True)
def redis_fittizio(monkeypatch):
    """Sostituisce il client Redis usato per annullamento e timeout."""
    monkeypatch.setattr(graph_module.aioredis, 'from_url', lambda url: FakeRedis())


@pytest.fixture
def provider_gestito(monkeypatch):
    """Un ManagedAPIProvider costruito su doppi, senza chiave ne' rete.

    Le impostazioni reali sono congelate da pydantic e leggono l'ambiente:
    vanno sostituite in blocco, come fa test_llm.py, da cui arrivano i doppi.
    """
    monkeypatch.setattr(llm_module, 'ChatOpenAI', FakeChatModel)
    monkeypatch.setattr(
        llm_module,
        'settings',
        FakeSettings(
            llm_provider='qwen',
            llm_base_url='https://esempio.invalid/v1',
            max_output_tokens=4096,
            aws_region='eu-south-1',
        ),
    )
    return get_llm_provider(model='qwen3-32b')


# --- TI_14, anello 1: il provider riconosce il 429 --------------------------


@pytest.mark.asyncio
async def test_ti14_a_429_from_the_provider_becomes_a_rate_limit_error(provider_gestito):
    """Il 429 del provider gestito diventa RateLimitError, non un guasto generico.

    E' il primo anello: senza questa traduzione il grafo classificherebbe il
    rate limit come UPSTREAM per esclusione, e l'utente vedrebbe "errore del
    servizio" invece di "riprova fra poco".
    """
    provider_gestito.llm.errore = RuntimeError('richiesta rifiutata: 429 Too Many Requests')

    with pytest.raises(RateLimitError) as exc:
        await provider_gestito.invoke_agent([], [], timeout_s=30)

    # error_type e' cio' che il grafo legge per non dover indovinare dal testo.
    assert exc.value.error_type == 'RATE_LIMITED'


# --- TI_14, anello 2: il grafo classifica il fallimento ---------------------


@pytest.mark.asyncio
async def test_ti14_the_failure_report_carries_the_rate_limited_kind():
    """Un rate limit durante l'invocazione produce un report con kind RATE_LIMITED."""
    grafo = build_graph(provider=FakeProvider(error=RateLimitError('429 dal provider')))

    risultato = await grafo.execute_step(build_state())

    report = risultato['result']['report']
    assert report['status'] == 'FAILED'
    assert report['error']['kind'] == ErrorKind.RATE_LIMITED.value


@pytest.mark.asyncio
async def test_ti14_a_rate_limit_does_not_hang_the_execution():
    """L'esecuzione termina invece di restare in attesa indefinita.

    Il rate limit deve chiudere il passo, non farlo restare appeso: la task
    lato backend resterebbe RUNNING per sempre e nessun altro percorso la
    porterebbe a termine.
    """
    grafo = build_graph(provider=FakeProvider(error=RateLimitError('429 dal provider')))

    risultato = await grafo.execute_step(build_state())

    # Il passo si e' chiuso: c'e' un esito, e non e' una sospensione in attesa
    # di un input che nessuno fornira'.
    assert risultato['status'] in ('completed', 'failed')
    assert risultato.get('pendingInput') is None


@pytest.mark.asyncio
async def test_ti14_the_provider_is_not_retried_forever_on_a_rate_limit():
    """Il provider viene interpellato una volta sola: nessun ritentativo cieco.

    L'altra faccia dell'attesa indefinita: un ciclo di ritentativi su un 429
    non si blocca ma non finisce, e per l'utente e' la stessa cosa.
    """
    provider = FakeProvider(error=RateLimitError('429 dal provider'))
    grafo = build_graph(provider=provider)

    await grafo.execute_step(build_state())

    assert provider.calls == 1


# --- TI_14, anello 3: cio' che il backend riceve ----------------------------


@pytest.mark.xfail(
    reason="DIFETTO APERTO: execute_step restituisce status 'completed' per ogni "
           'report prodotto, anche quando quel report ha status FAILED. Il campo '
           "`error` di AgentStepResult — l'unico che il backend legge per "
           'ricavare error.code, via mapAgentErrorKind — resta quindi vuoto, e '
           'un rate limit arriva al backend come una task COMPLETED. RQ.8 non e\' '
           'soddisfatto end-to-end. Correzione non compresa in questa sessione',
    strict=True,
)
@pytest.mark.asyncio
async def test_ti14_the_step_result_tells_the_backend_the_run_failed():
    """Il backend deve poter distinguere un fallimento da un completamento.

    Il contratto AgentStepResult ha tre stati e un campo `error`: e' li' che
    il backend legge il valore da tradurre in error.code. Un report FAILED
    consegnato come 'completed' rende quel campo inutilizzabile e con esso
    tutta la mappatura degli errori dell'agente.
    """
    grafo = build_graph(provider=FakeProvider(error=RateLimitError('429 dal provider')))

    risultato = await grafo.execute_step(build_state())

    assert risultato['status'] == 'failed'
    assert risultato['error'] == ErrorKind.RATE_LIMITED.value
