"""Eccezioni condivise fra il grafo e i singoli agenti.

Perche' un modulo a parte: `ReadabilityTooLowError` e' sollevata dall'agente
Changelog e intercettata dal grafo, che la mappa su
`ErrorKind.READABILITY_TOO_LOW`. Definita dentro `agents/changelog.py` — dove
stava — creava un ciclo di import: `graph` importava `agents.changelog` per
avere l'eccezione, e `agents.changelog` importava `graph` per avere
`AgentCancelled` e `resume_action`.

Il ciclo non si vedeva sempre. Partendo da `src.graph` (come fanno i test)
l'import passa, perche' quando `changelog` chiede `AgentCancelled` il grafo lo
ha gia' definito. Partendo da `src.main` — cioe' avviando davvero il servizio —
si rompe: `main` importa `changelog`, che a meta' file importa `graph`, che
torna a chiedere a `changelog` una classe non ancora dichiarata, e uvicorn muore
con `ImportError: cannot import name 'ReadabilityTooLowError' from partially
initialized module`.

Questo modulo non importa nulla dal progetto, quindi non puo' partecipare a
nessun ciclo.
"""


class ReadabilityTooLowError(Exception):
    """Il testo prodotto non raggiunge la leggibilita' minima richiesta.

    Mappata su ErrorKind.READABILITY_TOO_LOW dal nodo di gestione errori.
    """

    def __init__(self, message: str):
        """Inizializza l'eccezione.

        Args:
            message (str): Il messaggio d'errore.
        """
        self.error_type = "READABILITY_TOO_LOW"
        super().__init__(message)
