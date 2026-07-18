# Code Guardian — PoC degli Agenti

Questo è il Proof of Concept (PoC) di **Code Guardian**, incentrato sulla validazione di tre agenti core (**Docs**, **OWASP**, **Changelog**) sviluppati su un'architettura condivisa a cinque nodi tramite **LangGraph**.

> **Nota per lo sviluppo**: L'orchestratore generale, il frontend, l'integrazione GitHub (Pull Request) e l'infrastruttura AWS sono deliberatamente fuori dal perimetro di questo PoC.

---

## 1. Prerequisiti: Configurazione dei Modelli (LLM)

Il PoC supporta tre provider intercambiabili tramite la variabile d'ambiente `LLM_PROVIDER`:
* `fake`: Non chiama nessun modello reale. Restituisce dati finti (utile solo per testare l'infrastruttura).
* `ollama`: Esecuzione locale e gratuita (consigliata per sviluppo offline).
* `anthropic`: Richiede una API key valida per usare Claude (risultati di massima qualità).

### Configurazione di Ollama (Locale e Gratis)
Se vuoi usare i modelli in locale, devi installare e avviare Ollama **sull'host nativo** (anche se deciderai di usare Docker per l'app principale).

1. **Installazione**: Scarica Ollama dal sito ufficiale (ollama.com/download) o usa Homebrew su macOS: `brew install ollama`.
2. **Avvio del server**: Apri un terminale dedicato e lancia:
   `ollama serve`
3. **Download del modello**: In un altro terminale, scarica il modello di default del progetto:
   `ollama pull qwen2.5-coder:7b`

### Configurazione di Claude (Anthropic)
Se preferisci usare Claude, assicurati di avere una chiave API valida. Non è obbligatorio salvarla nei file di configurazione: la modalità guidata della CLI ti permetterà di inserirla direttamente in memoria a runtime.

---

## 2. Installazione ed Avvio del Progetto

Puoi avviare il PoC in due modi. Scegli l'**Opzione A** per un setup rapido e isolato, o l'**Opzione B** se vuoi fare debugging diretto sul codice.

Tutti i comandi vanno eseguiti dalla cartella `Src/PoC`.

### Opzione A — Setup con Docker (Consigliata)
Richiede solo Docker e Docker Compose installati sul sistema.

1. **Crea il file di ambiente**:
   `cp .env.example .env`
   Apri il file `.env` e imposta `LLM_PROVIDER` (`ollama`, `anthropic` o `fake`).

2. **Metti alla prova l'ambiente (Build & Test)**:
   `docker compose build`
   `docker compose run --rm --entrypoint make code-guardian test`

3. **Esegui l'applicazione**:
   Lancia la CLI senza argomenti per entrare nella **modalità guidata interattiva**:
   `docker compose run --rm code-guardian`

---

### Opzione B — Installazione Nativa (Senza Docker)
Richiede Python 3.10 o superiore.

1. **Inizializza l'ambiente virtuale (venv)**:
   `python3 -m venv .venv`
   `source .venv/bin/activate`  # Su Windows: .venv\Scripts\activate
   `pip install -e ".[dev]"`

2. **Configura l'ambiente**:
   `cp .env.example .env`

3. **Esegui l'applicazione**:
   Avvia la modalità guidata:
   `python3 -m code_guardian.cli`

---

## 3. Guida all'Uso della CLI

Se non usi la modalità guidata, puoi invocare direttamente gli agenti specificando i flag richiesti.

### Comandi Diretti (Esempi)

* **Analisi Vulnerabilità (OWASP)**:
    * Docker: `docker compose run --rm code-guardian owasp --repo examples/sample_repo`
    * Nativo: `python3 -m code_guardian.cli owasp --repo examples/sample_repo`
* **Generazione Documentazione (Docs)**:
    * `python3 -m code_guardian.cli docs --repo examples/sample_repo --scope src`
* **Generazione Changelog**:
    * `python3 -m code_guardian.cli changelog --tasks examples/sprint_tasks.json --sprint S-12`

### Analizzare un proprio Repository
La cartella `./data` è montata come volume all'interno del container Docker. Per analizzare un tuo progetto:
1. Copia il tuo codice in `./data/il-mio-progetto`.
2. Lancia l'agente target puntando al path interno del container:
   `docker compose run --rm code-guardian owasp --repo /data/il-mio-progetto`

---

## 4. Test e Qualità del Codice

Il progetto adotta un approccio rigoroso basato sui tipi e su un'architettura pulita. I test girano offline e usano un provider mock (`fake`).

* **Esecuzione Test Suite**: `make test` (62 test deterministici).
* **Verifica Copertura (Coverage)**: `make coverage` (Target core attuale: ~92%).
* **Misura dell'Accuratezza (Golden Set)**: Per verificare le metriche di accuratezza dell'agente OWASP contro un dataset noto, esegui:
    `python3 scripts/measure_accuracy.py --provider ollama` # o anthropic

---

## 5. Architettura del Sistema (In sintesi)

Il cuore dell'applicazione è un unico grafo guidato da **LangGraph** che implementa una pipeline standard a 5 nodi:
1. carica_contesto ➔ 2. componi_prompt ➔ 3. invoca_llm ➔ 4. valida_e_parsa ➔ 5. assembla_report.

Il sistema è fortemente disaccoppiato tramite il pattern a porte e adattatori (Hexagonal Architecture). La validazione dei dati di output viene gestita rigidamente a livello strutturale da modelli **Pydantic v2**. Qualsiasi errore o eccezione a runtime viene intercettato dai nodi del grafo e incanalato in un report di fallimento (`status: "fallito"`), garantendo che l'applicazione non sollevi mai crash imprevisti e restituisca corretti exit code (`1`) utili per l'integrazione in pipeline di CI/CD.
