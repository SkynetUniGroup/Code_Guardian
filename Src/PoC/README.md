# Code Guardian — PoC degli agenti

Realizzazione del Proof of Concept descritto nel documento di progettazione:
una **fetta verticale** per ciascuno dei tre agenti (Docs, OWASP, Changelog),
sopra un'infrastruttura condivisa.

Fuori dal perimetro, per scelta: orchestratore, frontend, apertura di Pull
Request su GitHub, infrastruttura AWS.

## Avvio rapido

Serve Python ≥ 3.10. `models.py` usa Pydantic v2, quindi va installato il
pacchetto (`pip install -e .`) prima di eseguire i test o la CLI.

```bash
# 0. installazione (Pydantic è una dipendenza di base)
pip install -e ".[dev]"

# 1. test (offline, deterministici, senza costi)
make test

# 2. esecuzione con un modello locale
export LLM_PROVIDER=ollama
python3 -m code_guardian.cli owasp --repo examples/sample_repo

# 3. esecuzione con Claude
export LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-...
python3 -m code_guardian.cli docs --repo examples/sample_repo --scope src
python3 -m code_guardian.cli changelog --tasks examples/sprint_tasks.json --sprint S-12

# 4. misura dell'accuratezza (RQ.2)
python3 scripts/measure_accuracy.py --provider anthropic
```

Se non hai installato il pacchetto, anteponi `PYTHONPATH=src` ai comandi.

## Architettura

Un solo grafo a cinque nodi, condiviso dai tre agenti. Ciò che varia da un
agente all'altro è confinato in due porte.

```
                    ┌──────────────┐
                    │  AgentGraph  │   dipende SOLO dalle interfacce
                    └──────┬───────┘
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
 «interface»         «interface»         «interface»
 ContextLoader       AgentProfile        LLMProvider
        │                  │                  │
 ┌──────┴──────┐   ┌───────┼───────┐   ┌──────┼──────┐
 LocalRepo     Task Docs  Owasp  Changelog  Anthropic Ollama Fake
 Loader     Fixture Inline Scan   Tech      Provider
```

I cinque nodi: `carica_contesto` → `componi_prompt` → `invoca_llm` →
`valida_e_parsa` → `assembla_report`.

L'unico punto che vede insieme le classi concrete è `cli.py`, che le inietta nel
grafo. Questo permette a più sviluppatori di lavorare in parallelo dietro le
interfacce.

## Struttura

| Percorso | Contenuto |
|---|---|
| `src/code_guardian/models.py` | Contratto dati condiviso (`Report` e blocchi) |
| `src/code_guardian/ports.py` | Le tre porte astratte + `AgentState` |
| `src/code_guardian/graph.py` | Lo scheletro a 5 nodi, timeout e rami d'errore |
| `src/code_guardian/llm/` | `AnthropicProvider`, `OllamaProvider`, `FakeLLMProvider` |
| `src/code_guardian/context/` | `LocalRepoLoader`, `TaskFixtureLoader` |
| `src/code_guardian/agents/` | I tre `AgentProfile` |
| `src/code_guardian/prompts/` | I prompt, **file esterni** (RQ.8) |
| `scripts/measure_accuracy.py` | Misura di accuratezza contro il golden set |

## Scelte progettuali

**Grafo su LangGraph.** I cinque nodi sono uno `StateGraph` di LangGraph, con
`AgentState` (la dataclass già definita in `ports.py`, non duplicata) come
`state_schema`. I quattro nodi di lavoro catturano le proprie eccezioni e le
scrivono in `AgentState.error`; un arco condizionale dopo ciascuno devia a un
nodo terminale `gestisci_errore` quando `error` è valorizzato, altrimenti
prosegue — la traduzione nativa del try/except che avvolgeva l'intera pipeline
nella versione con il runner interno. I test girano comunque offline,
deterministici e a costo zero, perché non toccano rete né un LLM vero (si usa
`FakeLLMProvider`).

**Modelli in Pydantic v2.** `models.py` usa `BaseModel`: `Block` e
`Remediation` sono unioni discriminate sul campo `kind`
(`Field(discriminator="kind")`), e i modelli che erano `dataclass(frozen=True)`
restano immutabili tramite `model_config = ConfigDict(frozen=True)`. La
validazione un tempo manuale (gravità nei 5 livelli, `start_line >= 1`,
`end_line >= start_line`) è ora imposta dai modelli stessi; se un agente
costruisce un blocco con dati non validi, Pydantic solleva `ValidationError`,
che il nodo del grafo che la incontra cattura (ramo `except Exception`) e
traduce in `AgentState.error`; l'arco condizionale la instrada a
`gestisci_errore`, che produce un `Report` con `status: "fallito"` ed
`error.type: "parse"` — il grafo non solleva mai.

**Nessuna scrittura sul repository.** Gli agenti producono solo `Proposal`, e
`pr_link` resta `None`. Il campo esiste già nel modello: l'integrazione con
GitHub non richiederà modifiche al contratto dati.

**Prompt fuori dal codice.** Vivono in `prompts/*.md` con sezioni `[SYSTEM]` e
`[USER]`. Ogni agente possiede il proprio file, quindi tre sviluppatori non
toccano mai le stesse righe.

**AWS sostituito, non rimosso.** `AnthropicProvider` è una realizzazione di
`LLMProvider`. Aggiungere `BedrockProvider` quando AWS sarà disponibile significa
aggiungere una classe e una riga in `build_provider`.

> **Nota di sicurezza (RS.4).** Usando l'API Anthropic diretta occorre
> selezionare un livello di servizio che garantisca che il codice sorgente
> analizzato non venga conservato né usato per addestrare modelli di terze parti.

## Comportamento in caso di errore

Il grafo non solleva mai eccezioni: ogni errore finisce nel `Report` con
`status: "fallito"` e un `error.type` fra `timeout`, `parse`, `context_missing`.
La CLI restituisce codice d'uscita 1, utile in pipeline CI.

## Stato della verifica

- 38 test, tutti verdi, eseguiti senza rete.
- Copertura dei moduli core: **93%** (obiettivo RQ.5: ≥ 75%).
- Il diff prodotto dall'agente Docs è stato verificato applicandolo con `patch`.

## Cosa manca (deliberatamente)

Agente Docs: README di progetto e documentazione API. Agente OWASP: la variante
policy-as-code è già supportata dal loader (legge `CLAUDE.md`) ma richiede un
proprio template di prompt. Agente Changelog: changelog di business, che è un
secondo passaggio sull'esito tecnico.
