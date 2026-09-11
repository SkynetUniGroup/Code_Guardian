"""TU_17 (RQ.4, metrica MPD_14) — isolamento dei prompt dai moduli Python.

RQ.4 chiede il disaccoppiamento totale dei prompt dalla logica: i prompt
stanno nei file YAML sotto ``prompts/``, i moduli Python li caricano e basta.
La verifica per analisi statica dell'AST e' quella che il Piano di Qualifica
associa alla metrica MPD_14: se in un modulo di ``src/`` comparisse una
stringa letterale lunga come un prompt, il disaccoppiamento sarebbe rotto
indipendentemente da cosa dice la documentazione.

Il test esisteva nel PoC come ``test_prompt_isolation.py`` e non era stato
portato nell'MVP; questo file lo ripristina, sulla struttura dell'MVP.

Perche' la soglia vale 200 caratteri: e' un valore in mezzo a due misure
reali, non una scelta di comodo. La stringa letterale piu' lunga oggi
presente in ``src/`` ne conta 142, mentre il piu' corto ``system_prompt``
dei sette file YAML ne conta 755 — e il test
``test_tu17_prompt_templates_all_stay_far_above_the_threshold`` verifica
proprio questa seconda meta', cosi' che la soglia resti tarata anche se i
prompt cambiano. Un prompt vero non puo' quindi nascondersi sotto la soglia,
e un messaggio d'errore legittimo non la sfiora.
"""

import ast
from pathlib import Path

import pytest
import yaml

_RADICE_AGENTI = Path(__file__).resolve().parent.parent
_SORGENTI = _RADICE_AGENTI / 'src'
_PROMPTS = _RADICE_AGENTI / 'prompts'

#: Lunghezza massima ammessa per il testo letterale di una stringa in src/.
SOGLIA_CARATTERI = 200

#: Soglia, molto piu' bassa, per il testo che viene consegnato al modello
#: come contenuto di un messaggio: li' anche poche righe sono un prompt.
SOGLIA_TESTO_AL_MODELLO = 40

#: I costruttori LangChain che portano istruzioni *al* modello. AIMessage e'
#: escluso di proposito: rimanda indietro l'output del modello stesso, non e'
#: testo che scriviamo noi.
_COSTRUTTORI_DI_MESSAGGIO = ('HumanMessage', 'SystemMessage')


def _moduli_degli_agenti() -> list[Path]:
    """I moduli Python del servizio agenti, quelli sotto esame.

    Returns:
        list[Path]: I percorsi dei moduli, in ordine deterministico.
    """
    return sorted(_SORGENTI.rglob('*.py'))


def _albero(percorso: Path) -> ast.Module:
    """Analizza un modulo e ne restituisce l'AST.

    Args:
        percorso (Path): Il modulo da analizzare.

    Returns:
        ast.Module: L'albero sintattico del modulo.
    """
    return ast.parse(percorso.read_text(encoding='utf-8'))


def _identita_delle_docstring(albero: ast.Module) -> set[int]:
    """Le docstring di modulo, classe e funzione, da non contare.

    Una docstring e' una stringa letterale come le altre per l'AST, ma e'
    documentazione: contarla renderebbe il test una misura della prolissita'
    dei commenti invece che dell'isolamento dei prompt.

    Args:
        albero (ast.Module): L'albero del modulo.

    Returns:
        set[int]: Gli identificatori dei nodi che sono docstring.
    """
    identita = set()
    contenitori = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
    for nodo in ast.walk(albero):
        if not isinstance(nodo, contenitori):
            continue
        corpo = getattr(nodo, 'body', None)
        if (
            corpo
            and isinstance(corpo[0], ast.Expr)
            and isinstance(corpo[0].value, ast.Constant)
            and isinstance(corpo[0].value.value, str)
        ):
            identita.add(id(corpo[0].value))

        # Anche le docstring di attributo (PEP 258): una stringa da sola
        # subito dopo un'assegnazione documenta quel nome, ed e' cosi' che
        # config.py descrive `settings`. Per l'AST non e' una docstring --
        # non e' la prima istruzione del contenitore -- ma documentazione lo
        # e' comunque, e contarla farebbe di questo test una misura della
        # prolissita' dei commenti invece che dell'isolamento dei prompt.
        if corpo:
            for precedente, successivo in zip(corpo, corpo[1:]):
                if (
                    isinstance(precedente, (ast.Assign, ast.AnnAssign))
                    and isinstance(successivo, ast.Expr)
                    and isinstance(successivo.value, ast.Constant)
                    and isinstance(successivo.value.value, str)
                ):
                    identita.add(id(successivo.value))
    return identita


def _testo_letterale(nodo: ast.AST) -> int:
    """Quanti caratteri di testo scritto a mano porta un nodo.

    Una f-string vale la somma delle sue parti costanti: le espressioni
    interpolate sono valori a runtime, non testo del prompt, mentre le parti
    fisse lo sono esattamente quanto una stringa normale.

    Args:
        nodo (ast.AST): Il nodo da misurare.

    Returns:
        int: Il numero di caratteri letterali, 0 se il nodo non ne porta.
    """
    if isinstance(nodo, ast.Constant) and isinstance(nodo.value, str):
        return len(nodo.value)
    if isinstance(nodo, ast.JoinedStr):
        return sum(
            len(parte.value)
            for parte in nodo.values
            if isinstance(parte, ast.Constant) and isinstance(parte.value, str)
        )
    return 0


def _stringhe_del_modulo(percorso: Path) -> list[tuple[int, int, str]]:
    """Le stringhe letterali di un modulo, docstring escluse.

    Args:
        percorso (Path): Il modulo da analizzare.

    Returns:
        list[tuple[int, int, str]]: Terne (lunghezza, riga, anteprima).
    """
    albero = _albero(percorso)
    docstring = _identita_delle_docstring(albero)

    # Le parti costanti di una f-string vengono misurate insieme, come un
    # testo solo: contarle una per una lascerebbe passare un prompt scritto su
    # piu' righe con un'interpolazione in mezzo a ciascuna.
    parti_di_fstring = {
        id(parte)
        for nodo in ast.walk(albero)
        if isinstance(nodo, ast.JoinedStr)
        for parte in nodo.values
    }

    trovate: list[tuple[int, int, str]] = []
    for nodo in ast.walk(albero):
        if isinstance(nodo, ast.JoinedStr):
            testo = ''.join(
                parte.value
                for parte in nodo.values
                if isinstance(parte, ast.Constant) and isinstance(parte.value, str)
            )
            trovate.append((len(testo), nodo.lineno, testo[:60]))
            continue
        if not (isinstance(nodo, ast.Constant) and isinstance(nodo.value, str)):
            continue
        if id(nodo) in docstring or id(nodo) in parti_di_fstring:
            continue
        trovate.append((len(nodo.value), nodo.lineno, nodo.value[:60]))
    return trovate


def _prompt_scritti_nel_codice(percorso: Path) -> list[tuple[int, int]]:
    """I messaggi al modello il cui contenuto e' testo scritto nel modulo.

    Cerca le chiamate a HumanMessage/SystemMessage e risale al testo del loro
    argomento ``content``: sia quando e' un letterale, sia quando e' un nome
    assegnato poco sopra nella stessa funzione, che e' la forma in cui il
    codice li scrive davvero.

    Args:
        percorso (Path): Il modulo da analizzare.

    Returns:
        list[tuple[int, int]]: Coppie (riga, caratteri di testo).
    """
    albero = _albero(percorso)
    trovati: list[tuple[int, int]] = []

    for funzione in ast.walk(albero):
        if not isinstance(funzione, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue

        lunghezza_per_nome: dict[str, int] = {}
        for nodo in ast.walk(funzione):
            if not isinstance(nodo, ast.Assign):
                continue
            for bersaglio in nodo.targets:
                if isinstance(bersaglio, ast.Name):
                    # Il massimo, non l'ultimo visto: una funzione puo'
                    # assegnare lo stesso nome piu' volte -- graph.py lo fa
                    # con retry_msg -- e tenere solo l'ultima significava che
                    # bastava spostarne una nel YAML perche' l'altra
                    # sparisse dal conteggio.
                    lunghezza_per_nome[bersaglio.id] = max(
                        lunghezza_per_nome.get(bersaglio.id, 0),
                        _testo_letterale(nodo.value),
                    )

        for nodo in ast.walk(funzione):
            if not isinstance(nodo, ast.Call) or not isinstance(nodo.func, ast.Name):
                continue
            if nodo.func.id not in _COSTRUTTORI_DI_MESSAGGIO:
                continue
            for argomento in nodo.keywords:
                if argomento.arg != 'content':
                    continue
                lunghezza = _testo_letterale(argomento.value)
                if isinstance(argomento.value, ast.Name):
                    lunghezza = lunghezza_per_nome.get(argomento.value.id, 0)
                if lunghezza > SOGLIA_TESTO_AL_MODELLO:
                    trovati.append((nodo.lineno, lunghezza))
    return trovati


# --- TU_17 -----------------------------------------------------------------


def test_tu17_the_ast_scan_actually_reaches_the_agent_modules():
    """L'analisi guarda davvero qualcosa, altrimenti passerebbe a vuoto.

    Senza questo controllo ogni asserzione sotto resterebbe verde anche con
    una cartella ``src/`` vuota o un ``rglob`` sbagliato, cioe' il test
    varrebbe come copertura falsa nel conteggio del Piano di Qualifica.
    """
    moduli = _moduli_degli_agenti()

    assert len(moduli) >= 8, f'Trovati solo {len(moduli)} moduli sotto {_SORGENTI}'
    assert {'graph.py', 'models.py', 'llm.py'} <= {m.name for m in moduli}

    totale = sum(len(_stringhe_del_modulo(m)) for m in moduli)
    assert totale > 100, f'Solo {totale} stringhe letterali analizzate: analisi sospetta'


def test_tu17_no_literal_string_exceeds_the_prompt_length_threshold():
    """Nessuna stringa letterale di src/ supera la soglia configurata.

    E' la formulazione diretta di MPD_14: un prompt e' un testo lungo, e se
    nessun testo lungo vive nel codice allora i prompt stanno tutti fuori.
    """
    oltre_soglia = [
        f'{modulo.relative_to(_RADICE_AGENTI)}:{riga} — {lunghezza} caratteri: {anteprima!r}'
        for modulo in _moduli_degli_agenti()
        for lunghezza, riga, anteprima in _stringhe_del_modulo(modulo)
        if lunghezza > SOGLIA_CARATTERI
    ]

    assert oltre_soglia == [], (
        f'Stringhe letterali oltre i {SOGLIA_CARATTERI} caratteri nei moduli '
        f'degli agenti: se sono prompt vanno spostate nei file YAML di '
        f'prompts/ (RQ.4, MPD_14).\n' + '\n'.join(oltre_soglia)
    )


def test_tu17_prompt_templates_all_stay_far_above_the_threshold():
    """La soglia e' tarata: nessun prompt vero le passerebbe sotto.

    Verifica la meta' che rende non arbitrario il numero scelto. Se un
    ``system_prompt`` scendesse sotto la soglia, il test precedente
    smetterebbe di poter distinguere un prompt da un messaggio d'errore, e
    andrebbe ritarato prima che accada, non dopo.
    """
    # I template sotto prompts/graph/ restano fuori: sono i messaggi con cui
    # il grafo chiede al modello di rifare un output, e uno dei due sta sotto
    # la soglia perche' e' corto davvero, non perche' sia un messaggio
    # d'errore travestito. La soglia a lunghezza non puo' vedere un prompt
    # corto -- e' il limite che questo test misura -- ed e' il motivo per cui
    # esiste test_tu17_no_prompt_text_is_assembled_inline_for_the_model, che
    # li riconosce da come vengono usati invece che da quanto sono lunghi.
    file_yaml = sorted(
        percorso for percorso in _PROMPTS.rglob('*.yaml') if percorso.parent.name != 'graph'
    )
    assert len(file_yaml) == 7, f"Attesi sette template d'agente, trovati {len(file_yaml)}"

    troppo_corti = []
    for percorso in file_yaml:
        documento = yaml.safe_load(percorso.read_text(encoding='utf-8'))
        prompt_di_sistema = documento.get('system_prompt', '')
        if len(prompt_di_sistema) <= SOGLIA_CARATTERI:
            troppo_corti.append(
                f'{percorso.name}: system_prompt di {len(prompt_di_sistema)} caratteri'
            )

    assert troppo_corti == [], (
        f'Questi prompt starebbero sotto la soglia di {SOGLIA_CARATTERI} '
        f'caratteri, che quindi non e\' piu\' in grado di distinguerli da un '
        f'messaggio qualsiasi:\n' + '\n'.join(troppo_corti)
    )


def test_tu17_every_prompt_template_is_loaded_from_the_external_directory():
    """I template si raggiungono solo passando da ``settings.prompts_dir``.

    L'altra faccia dell'isolamento: non basta che i file esistano fuori dal
    codice, serve che il codice non abbia una seconda strada per procurarsi
    un prompt.
    """
    base = (_SORGENTI / 'agents' / '_base.py').read_text(encoding='utf-8')

    assert 'settings.prompts_dir' in base
    assert 'yaml.safe_load' in base

    # Nessun modulo incorpora un template YAML riscrivendolo nel sorgente.
    for modulo in _moduli_degli_agenti():
        testo = modulo.read_text(encoding='utf-8')
        assert 'system_prompt:' not in testo, (
            f'{modulo.name} sembra contenere un template YAML incorporato'
        )


def test_tu17_no_prompt_text_is_assembled_inline_for_the_model():
    """Nessun testo destinato al modello viene composto dentro i moduli.

    RQ.4 parla di disaccoppiamento *totale*: un'istruzione al modello scritta
    nel codice e' un prompt anche se e' corta, perche' cambiarla richiede di
    toccare il sorgente invece del file di configurazione.
    """
    inline = [
        f'{modulo.relative_to(_RADICE_AGENTI)}:{riga} — {caratteri} caratteri'
        for modulo in _moduli_degli_agenti()
        for riga, caratteri in _prompt_scritti_nel_codice(modulo)
    ]

    assert inline == [], (
        'Messaggi al modello con testo scritto nel codice invece che nei '
        'template YAML:\n' + '\n'.join(inline)
    )
