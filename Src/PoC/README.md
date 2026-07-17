# Code Guardian — PoC degli agenti

Questo è il Proof of Concept del documento di progettazione di Code
Guardian: una fetta verticale per ciascuno dei tre agenti previsti (Docs,
OWASP, Changelog), costruita sopra un'infrastruttura condivisa.

Restano fuori dal perimetro, per scelta: l'orchestratore, il frontend,
l'apertura di Pull Request su GitHub e l'infrastruttura AWS. Non è che
manchino per dimenticanza — semplicemente non sono necessari per validare
ciò che questo PoC deve validare.

## Avvio rapido

Tutti i comandi qui sotto vanno lanciati dalla cartella `Src/PoC`, dove si
trova questo README. Ci sono due modi per avviare il progetto:

- **[Opzione 1 — Docker](#opzione-1--docker-consigliata)** (consigliata): non
  serve avere Python installato, e funziona allo stesso modo su Linux,
  macOS e Windows.
- **[Opzione 2 — installazione nativa](#opzione-2--installazione-nativa-senza-docker)**:
  comoda se stai lavorando sul codice e vuoi debugger, editor e `make test`
  senza passare da un container.

Il comportamento applicativo è identico in entrambi i casi: tre
`LLMProvider` intercambiabili (`fake`, `ollama`, `anthropic`), selezionabili
con `LLM_PROVIDER`.

Se non hai voglia di imparare i flag a memoria, in entrambi i casi puoi
lanciare la CLI senza argomenti: entra in una **modalità guidata** che
chiede quale agente eseguire e quale modello usare, poi si comporta
esattamente come se avessi passato quegli argomenti a mano. È il modo più
rapido per fare una prima prova. Se scegli Claude, ti chiede anche la
chiave — a schermo non la vedi comparire mentre la digiti — e la tiene solo
in memoria per quell'esecuzione: non la scrive né in `.env` né altrove. Se
ne hai già una configurata e non vuoi ridigitarla, basta premere Invio. Al
termine ti chiede se vuoi eseguire un'altra operazione: puoi provare più
agenti, o lo stesso agente su repository diversi, senza rilanciare il
comando ogni volta.

### Opzione 1 — Docker (consigliata)

Ti serve solo [Docker](https://docs.docker.com/get-docker/) con Docker
Compose incluso (su macOS e Windows arriva già con Docker Desktop; su Linux
verifica con `docker compose version`). Il progetto contiene un solo
servizio, `code-guardian`: l'immagine con la CLI (Python 3.12, costruita da
questo `Dockerfile`).

Ollama **non** è containerizzato — il perché è spiegato in [Scelte
progettuali](#scelte-progettuali), con tanto di numeri. In breve: se vuoi
usare il provider `ollama`, installalo ed eseguilo direttamente sulla tua
macchina (stessi comandi dell'[Opzione 2, sezione
A](#opzione-a--ollama-locale-gratis)); il container lo raggiunge comunque,
tramite `host.docker.internal` — un indirizzo **fisso**, definito solo in
`docker-compose.yml`, che non risente di eventuali valori diversi lasciati
in `.env` (dove `OLLAMA_BASE_URL` punta correttamente a `localhost`, ma
solo per l'installazione nativa).

#### 1. Configurazione

```bash
cp .env.example .env
```

Apri `.env` e imposta `LLM_PROVIDER` (`ollama`, `anthropic` o `fake`) e, se
usi Claude, `ANTHROPIC_API_KEY`. Docker Compose legge questo stesso file per
valorizzare le variabili d'ambiente del container, quindi non serve altro.
Se salti questo passo, ogni variabile prende il proprio default indicato in
`docker-compose.yml` — il provider di default è `anthropic`.

#### 2. Costruisci l'immagine ed esegui i test

```bash
docker compose build
docker compose run --rm --entrypoint make code-guardian test
```

I 62 test non hanno bisogno di nessun provider: girano offline dentro al
container, esattamente come nell'installazione nativa.

#### 3. Esegui un agente

Senza argomenti parte la modalità guidata:

```bash
docker compose run --rm code-guardian
```

Oppure, se preferisci essere esplicito:

```bash
docker compose run --rm code-guardian owasp     --repo examples/sample_repo
docker compose run --rm code-guardian docs      --repo examples/sample_repo --scope src
docker compose run --rm code-guardian changelog --tasks examples/sprint_tasks.json --sprint S-12
```

Il provider usato è quello che hai messo in `LLM_PROVIDER` in `.env`; per
una singola esecuzione puoi sovrascriverlo aggiungendo `--provider ollama`
(o `anthropic`, `fake`) in coda al comando.

```bash
docker compose run --rm code-guardian owasp --repo examples/sample_repo --provider fake
```

Questo comando **non produce un risultato utile**: `fake` non chiama nessun
modello, risponde sempre con dati finti, quindi il report che ottieni sarà
sempre `status: fallito`. Serve solo a controllare che l'immagine sia
costruita bene e che il collegamento fra i pezzi funzioni — se vuoi vedere
un riscontro vero (una vulnerabilità trovata, una proposta di
documentazione), ti serve `--provider ollama` o `--provider anthropic`.

#### 4. Analizza un tuo repository (non quello d'esempio)

La cartella `./data`, accanto a `docker-compose.yml`, è montata dentro ogni
container `code-guardian` come `/data`. Copiaci o clonaci dentro quello che
vuoi analizzare, poi passa quel percorso:

```bash
cp -r /percorso/del/tuo/progetto ./data/mio-progetto
docker compose run --rm code-guardian owasp --repo /data/mio-progetto
```

Vale lo stesso per una fixture di task personalizzata dell'agente
Changelog: mettila in `./data/` e passa `--tasks /data/nome-file.json`.

#### 5. Pulizia

```bash
docker compose down
```

#### Risoluzione problemi (Docker)

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| `Configurazione mancante: ANTHROPIC_API_KEY non impostata` | Hai scelto il provider `anthropic` ma non hai messo la chiave in `.env` | Aggiungi `ANTHROPIC_API_KEY` a `.env`, oppure usa `--provider ollama`/`fake`. In modalità guidata non blocca l'app: rispondi "sì" a "Vuoi eseguire un'altra operazione?" e scegli un altro provider |
| Report con `status: fallito` e `"Ollama non raggiungibile"` (`Errno 111`/`Errno 61`, "Connection refused") | 1) Ollama non è in esecuzione sull'host, oppure 2) — solo se hai un `.env` creato prima di [questo fix](#scelte-progettuali) — `OLLAMA_BASE_URL` in `.env` sovrascriveva `host.docker.internal` con `localhost`, indirizzando il container verso se stesso | Verifica che `ollama serve` sia attivo sull'host (Opzione 2, sezione A); se il problema persiste con Ollama sicuramente attivo, prova a farlo ascoltare su tutte le interfacce (`OLLAMA_HOST=0.0.0.0`, vedi il riquadro nella sezione A) — capita più spesso su Windows con WSL2 |
| Report con `status: fallito` e `"Nessuna risposta entro Ns"` col provider `ollama` | Un modello locale (specie il 7B di default) è lento: è normale che superi qualche decina di secondi, anche su hardware con GPU | Di norma non serve fare nulla: il default per `ollama` è già 300s (vedi sotto). Se serve ancora di più, aggiungi `--timeout 600` (o il valore che preferisci) |
| Il file passato con `--repo`/`--tasks` non si trova dentro al container | Hai passato un percorso del tuo host, ma dentro al container non esiste | Copia il file o la cartella in `./data/` e usa il percorso `/data/...` (vedi passo 4) |

### Opzione 2 — installazione nativa (senza Docker)

Ti serve Python 3.10 o superiore.

#### 0. Controlla la tua versione di Python

```bash
python3 --version
```

Se è più vecchia della 3.10 (capita spesso — macOS, ad esempio, ha di serie
Python 3.9, e molte distribuzioni Linux LTS restano ancora sulla 3.8), procurati
una versione più recente prima di andare avanti. Non basta un `pip install`:
va creato il venv con l'interprete giusto fin dall'inizio.

```bash
# macOS, via Homebrew
brew install python@3.12
/opt/homebrew/bin/python3.12 --version   # verifica che sia lì

# Ubuntu/Debian, via il PPA deadsnakes
sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt update
sudo apt install python3.12 python3.12-venv

# Windows: scarica l'installer da https://www.python.org/downloads/
# e spunta "Add python.exe to PATH" durante l'installazione
```

Poi usa quell'interprete specifico al posto di `python3` nel passo 1 (su
macOS, ad esempio, `/opt/homebrew/bin/python3.12 -m venv .venv`; su
Ubuntu, `python3.12 -m venv .venv`).

Se preferisci non pensarci affatto, l'[Opzione 1 — Docker](#opzione-1--docker-consigliata)
qui sopra include già Python 3.12 nell'immagine: è il motivo per cui è la
via consigliata quando non sai già che versione hai a disposizione.

#### 1. Installazione

```bash
python3 -m venv .venv          # con Python 3.10+ — vedi il passo 0 se non ce l'hai
source .venv/bin/activate      # su Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

Se preferisci non tenere il venv sempre attivo, puoi anteporre
`PYTHONPATH=src` a ogni comando invece di attivarlo ogni volta.

#### 2. Configurazione

```bash
cp .env.example .env
```

Apri `.env` e valorizza almeno `LLM_PROVIDER` (vedi il passo 3 per le
opzioni). Il file è del tutto opzionale: `config.py` lo cerca con un
percorso assoluto, quindi lo trova anche se lanci i comandi da un'altra
cartella, e la sua assenza non è un errore — si usano semplicemente i
default. Una variabile già presente nella shell (ad esempio
`ANTHROPIC_API_KEY=sk-... comando`) ha comunque sempre la precedenza su
quanto scritto in `.env`.

#### 3. Scegli un fornitore di modello

Il progetto supporta tre `LLMProvider`, intercambiabili tra loro. Nessuno è
richiesto per eseguire i test (passo 4): serve solo quando vuoi far girare
davvero un agente (passo 5).

**Solo `ollama` e `anthropic` producono risultati veri** (una vulnerabilità
trovata, una proposta di documentazione, un changelog). `fake` non chiama
nessun modello: risponde sempre con dati finti, quindi qualunque agente tu
lanci con `--provider fake` otterrà un report con `status: fallito` — è il
comportamento atteso, non un errore. Serve solo a verificare che
l'installazione (venv, dipendenze, Docker) funzioni, senza spendere nulla e
senza toccare la rete.

| Provider | Cosa richiede | Costo | Produce risultati veri? | Quando ha senso |
|---|---|---|---|---|
| `fake` | Niente | Zero | **No, sempre `fallito`** | Verificare che l'installazione funzioni |
| `ollama` | Ollama installato e **in esecuzione** | Zero | Sì | Sviluppo offline |
| `anthropic` | Una `ANTHROPIC_API_KEY` valida | A pagamento | Sì | Quando vuoi risultati di qualità (Claude) |

**Il default è `anthropic`**, se non specifichi nulla. Puoi cambiarlo in due
modi equivalenti — se li usi entrambi, vince quello sulla riga di comando:

```bash
# in .env
LLM_PROVIDER=ollama

# oppure sulla riga di comando, per un singolo comando
python3 -m code_guardian.cli owasp --repo examples/sample_repo --provider ollama
```

##### Opzione A — Ollama (locale, gratis)

Ollama è un motore che fa girare modelli open-source sul tuo computer: non
ha nulla a che fare con Claude, è semplicemente un altro fornitore di
modello, alternativo ad Anthropic.

```bash
brew install ollama            # macOS; per altri sistemi: https://ollama.com/download
ollama serve                   # lascialo aperto in un terminale dedicato
                                # (in alternativa, installa l'app Ollama, che lo tiene attivo da sola)
ollama pull qwen2.5-coder:7b   # scarica il modello di default del progetto, una tantum
```

Poi in `.env`: `LLM_PROVIDER=ollama`. Se Ollama non è in esecuzione, non
succede niente di drammatico: l'agente restituisce semplicemente un report
con `status: fallito` e un messaggio che dice "Ollama non raggiungibile:
[Errno 61] Connection refused".

Un modello locale è più lento di Claude — anche con accelerazione GPU, una
scansione OWASP può richiedere un minuto o più. Per questo, quando il
provider è `ollama` e non passi `--timeout` esplicitamente, il limite di
default non è i 45s di RQ.7 (pensati per Claude) ma **300s**
(`OLLAMA_AGENT_TIMEOUT_S` in `.env`, se vuoi cambiarlo). Se anche 300s non
bastano — hardware più lento, repository più grandi — aggiungi
`--timeout 600` o il valore che preferisci.

**Solo se esegui l'app tramite Docker** (Opzione 1) mentre Ollama resta
nativo su questa macchina, e nonostante `host.docker.internal` risolva
correttamente il container continua a ricevere "Connection refused": può
darsi che Ollama, in ascolto solo su `127.0.0.1`, rifiuti richieste che
arrivano dalla rete virtuale di Docker invece che da loopback — capita più
spesso su Windows con WSL2, più raramente su macOS. Fallo ascoltare su
tutte le interfacce prima di avviarlo:

```bash
# macOS / Linux
OLLAMA_HOST=0.0.0.0 ollama serve
```

```powershell
# Windows (PowerShell)
$env:OLLAMA_HOST = "0.0.0.0"
ollama serve
```

Se usi l'app Ollama invece del comando da terminale, imposta `OLLAMA_HOST`
come variabile d'ambiente di sistema permanente e riavvia l'app — non legge
variabili impostate solo per la sessione del terminale. Se esegui l'app
nativamente (Opzione 2, senza Docker) sulla stessa macchina, questo passo
non serve: `localhost` funziona già senza modifiche.

##### Opzione B — Claude (Anthropic, a pagamento)

In `.env`:

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-...
```

Senza questa chiave, i comandi che usano il provider `anthropic` si fermano
prima di eseguire l'agente, con il messaggio "Configurazione mancante:
ANTHROPIC_API_KEY non impostata" e codice d'uscita `1` — niente traceback,
in modalità guidata puoi anche scegliere subito un altro provider senza che
il programma si chiuda. Non è un malfunzionamento dell'applicazione: è solo
una configurazione mancante.

> **Nota di sicurezza (RS.4).** Se usi l'API Anthropic diretta, scegli un
> livello di servizio che garantisca che il codice sorgente analizzato non
> venga conservato né usato per addestrare modelli di terze parti.

#### 4. Esegui i test (nessun provider richiesto)

```bash
make test        # 62 test, offline, deterministici, a costo zero
make coverage     # come sopra, con in più il report di copertura
```

#### 5. Esegui un agente

Senza argomenti parte la modalità guidata:

```bash
python3 -m code_guardian.cli
```

Oppure, se sai già cosa vuoi fare:

```bash
python3 -m code_guardian.cli owasp     --repo examples/sample_repo
python3 -m code_guardian.cli docs      --repo examples/sample_repo --scope src
python3 -m code_guardian.cli changelog --tasks examples/sprint_tasks.json --sprint S-12
```

Ogni comando stampa un report in Markdown; aggiungi `--format json` se ti
serve il JSON. Il codice d'uscita è `1` se l'agente fallisce (`status:
fallito`), utile per accorgersene in una pipeline CI.

#### 6. Misura l'accuratezza (RQ.2)

Questo comando ha bisogno di un provider vero (non `fake`), perché confronta
i riscontri reali dell'agente OWASP con un golden set predefinito:

```bash
python3 scripts/measure_accuracy.py --provider anthropic
# oppure, in locale con Ollama già attivo:
python3 scripts/measure_accuracy.py --provider ollama
```

#### Risoluzione problemi (installazione nativa)

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| `Configurazione mancante: ANTHROPIC_API_KEY non impostata` | Hai scelto il provider `anthropic` ma manca la chiave | Impostala in `.env`, oppure `export ANTHROPIC_API_KEY=sk-...`, oppure passa `--provider ollama`/`fake`. In modalità guidata non blocca l'app: puoi scegliere subito un altro provider |
| Report con `status: fallito` e `"Ollama non raggiungibile"` | Il server Ollama non è in esecuzione | Apri un terminale ed esegui `ollama serve` |
| `ModuleNotFoundError: No module named 'code_guardian'` | Il pacchetto non è installato e non hai impostato `PYTHONPATH` | `pip install -e ".[dev]"` dentro un venv attivo, oppure anteponi `PYTHONPATH=src` al comando |
| `ModuleNotFoundError: No module named 'pydantic'` (o `langgraph`, `pydantic_settings`) | Il venv non è attivo, o l'installazione è incompleta | `source .venv/bin/activate` poi `pip install -e ".[dev]"` |

## Architettura

C'è un solo grafo a cinque nodi, condiviso dai tre agenti. Quello che cambia
da un agente all'altro è confinato in due porte soltanto.

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

I cinque nodi sono: `carica_contesto` → `componi_prompt` → `invoca_llm` →
`valida_e_parsa` → `assembla_report`.

L'unico punto del sistema che vede insieme tutte le classi concrete è
`cli.py`, che le inietta nel grafo. Questo lascia più sviluppatori liberi di
lavorare in parallelo dietro le rispettive interfacce, senza pestarsi i
piedi.

## Struttura

| Percorso | Contenuto |
|---|---|
| `src/code_guardian/config.py` | `Settings` (pydantic-settings): legge `.env` e le variabili d'ambiente |
| `src/code_guardian/models.py` | Il contratto dati condiviso (`Report` e i blocchi che lo compongono) |
| `src/code_guardian/ports.py` | Le tre porte astratte, più `AgentState` |
| `src/code_guardian/graph.py` | Lo scheletro a 5 nodi, con timeout e rami d'errore |
| `src/code_guardian/llm/` | `AnthropicProvider`, `OllamaProvider`, `FakeLLMProvider` |
| `src/code_guardian/context/` | `LocalRepoLoader`, `TaskFixtureLoader` |
| `src/code_guardian/agents/` | I tre `AgentProfile` |
| `src/code_guardian/prompts/` | I prompt, come file esterni al codice (RQ.8) |
| `scripts/measure_accuracy.py` | La misura di accuratezza contro il golden set |
| `Dockerfile` | L'immagine dell'app `code-guardian` (la CLI) |
| `docker-compose.yml` | Il servizio `code-guardian` |
| `data/` | Cartella montata nel container come `/data`, per i tuoi repository o fixture |

## Scelte progettuali

**Il timeout di RQ.7 vale per Claude, non per Ollama.** `config.py` ha due
soglie separate: `agent_timeout_s` (45s, RQ.7) e `ollama_agent_timeout_s`
(300s). `cli.py` sceglie quale usare in base al provider effettivo *solo*
se `--timeout` non è stato passato esplicitamente (che vince sempre,
qualunque provider). Non è un default scelto a caso: misurato su questo
stesso progetto, una scansione OWASP con `qwen2.5-coder:7b` ha impiegato
oltre 60 secondi anche su Apple Silicon con accelerazione Metal — un
modello locale è strutturalmente più lento di un'API cloud, e forzarlo
sotto lo stesso limite avrebbe reso `ollama` di fatto inutilizzabile per
qualunque repository non banale.

**L'app è containerizzata, Ollama no.** Solo `code-guardian` gira in un
container; il provider `ollama` resta pensato per un'installazione nativa
sull'host, che il container raggiunge tramite `host.docker.internal` (la
voce `extra_hosts` in `docker-compose.yml` serve solo su Linux — su Docker
Desktop, sia macOS che Windows, quel nome è già risolto di default). Questa
non è una scelta di principio, ma il risultato di una prova concreta:
Docker Desktop esegue i container in una VM Linux senza passthrough della
GPU dell'host, quindi un Ollama containerizzato gira sulla sola CPU. In un
test diretto su questo stesso progetto, `qwen2.5-coder:7b` ha generato a
circa **1,4 token al secondo** (contro le decine di token al secondo tipiche
dell'accelerazione Metal su Apple Silicon nativa) — una singola scansione
OWASP su un file di appena 20 righe non si è completata nemmeno in 300
secondi. Anche la variante più leggera, da 1,5 miliardi di parametri,
restava sotto i 6 token al secondo. Containerizzare comunque Ollama avrebbe
solo spostato il problema (un'immagine da ~2,7 GB, più modelli da 1 a 5 GB
l'uno), senza risolvere la questione di fondo, che è la velocità.

**`OLLAMA_BASE_URL` è un valore fisso in `docker-compose.yml`, non
interpolato da `.env`.** Una prima versione usava
`${OLLAMA_BASE_URL:-http://host.docker.internal:11434}`: sembra innocuo
(un default con fallback), ma se `.env` esiste — cioè sempre, dato che il
passo 1 chiede di crearlo da `.env.example` — la variabile lì dentro
(`OLLAMA_BASE_URL=http://localhost:11434`, corretta per l'installazione
nativa) vinceva silenziosamente sul default pensato per Docker. Il
risultato: il container tentava di contattare se stesso invece dell'host,
con un errore di connessione (`Errno 111`/`Errno 61`) indistinguibile, nei
sintomi, da un Ollama davvero spento o da un problema di rete — abbiamo
perso tempo reale a diagnosticarlo prima di trovare la causa. La lezione:
quando un valore deve restare sotto controllo del compose e non del `.env`
dell'utente, va scritto letterale, senza interpolazione `${...}`.

**Il grafo gira su LangGraph.** I cinque nodi sono uno `StateGraph`, e
usano `AgentState` — la dataclass già definita in `ports.py`, non
duplicata — come `state_schema`. I quattro nodi di lavoro catturano le
proprie eccezioni e le scrivono in `AgentState.error`; un arco condizionale
dopo ciascuno devia verso un nodo terminale, `gestisci_errore`, quando
`error` è valorizzato, altrimenti lascia proseguire il flusso normale. È la
traduzione naturale, nel linguaggio di LangGraph, del try/except che prima
avvolgeva l'intera pipeline nel runner interno. I test continuano a girare
offline, deterministici e a costo zero, perché non toccano né la rete né un
LLM vero — usano `FakeLLMProvider`.

**I modelli sono in Pydantic v2.** `models.py` usa `BaseModel`: `Block` e
`Remediation` sono unioni discriminate sul campo `kind`
(`Field(discriminator="kind")`), e i modelli che un tempo erano
`dataclass(frozen=True)` restano immutabili grazie a `model_config =
ConfigDict(frozen=True)`. La validazione che una volta si faceva a mano —
gravità limitata a 5 livelli, `start_line >= 1`, `end_line >= start_line` —
ora è imposta direttamente dai modelli. Se un agente prova a costruire un
blocco con dati non validi, Pydantic solleva un `ValidationError`, che il
nodo del grafo in cui succede cattura (ramo `except Exception`) e traduce in
`AgentState.error`; l'arco condizionale lo instrada a `gestisci_errore`, che
produce un `Report` con `status: "fallito"` ed `error.type: "parse"`. In
altre parole: il grafo non solleva mai, nemmeno in questo caso.

**La configurazione passa da pydantic-settings.** `Settings`, in
`config.py`, è un `BaseSettings`: ogni campo mappa da sé sulla variabile
d'ambiente omonima (`llm_provider` legge `LLM_PROVIDER`), e in più legge
`.env`. Il percorso di `.env` è assoluto — calcolato con `Path(__file__)`,
esattamente come fa già `scripts/measure_accuracy.py` per i propri path —
quindi viene trovato anche lanciando i comandi da un'altra cartella. Il file
è facoltativo: la sua assenza non è un errore. E se una variabile è già
presente in `os.environ`, questa vince sempre su quanto scritto in `.env`
(è il comportamento di default di pydantic-settings, e lo abbiamo
verificato per bene in `tests/test_config.py`, non dato per scontato).

**La modalità guidata non duplica il parser.** Quando `cli.py` viene
lanciato senza argomenti, `run_wizard` fa qualche domanda e poi traduce le
risposte nella stessa lista di argomenti che la CLI accetterebbe da riga di
comando — che passa poi per il solito `build_parser().parse_args(...)`. Non
esiste quindi una seconda via per costruire `ContextRef` o scegliere il
provider: la logica resta un'unica, in `_wire`. Chi lancia la CLI con i
flag (script, CI) non vede alcuna differenza, perché il wizard scatta solo
a fronte di un argv vuoto; se l'input finisce prima del previsto — capita
facilmente in ambienti non interattivi, come un container senza terminale
— la modalità guidata se ne accorge e chiude con un messaggio chiaro,
invece di un traceback su `EOFError`. Dopo ogni esecuzione, `main` chiede se
proseguire: se sì, richiama `run_wizard` da capo — è l'unico punto in cui
l'invocazione guidata si comporta diversamente da quella con i flag, che
resta a esecuzione singola apposta, per non sorprendere script e pipeline.

Un'eccezione a parte è `RuntimeError` (ad esempio `ANTHROPIC_API_KEY` non
impostata): non nasce dal grafo — arriva da `build_provider`, chiamato
*prima* che il grafo esista, quindi la garanzia "il grafo non solleva mai"
non la copre. `_run_once` la cattura esplicitamente e stampa un messaggio,
così una configurazione mancante non fa uscire dal ciclo: chi è in modalità
guidata torna semplicemente al menu.

**La chiave Anthropic inserita nel wizard non tocca mai il disco.** Se
scegli il provider `anthropic` in modalità guidata, `run_wizard` la chiede
con `getpass` (niente eco a schermo) e la passa direttamente a
`build_provider(..., api_key=...)`, che la inoltra al costruttore di
`AnthropicProvider` — la stessa via, invariata, che già usava `settings`
per leggerla da `.env` o dall'ambiente. Non passa mai da `Settings`, che
resta un `BaseSettings` immutabile e non sa nulla di questa chiave: non
c'è quindi alcun momento in cui la chiave venga scritta su `.env` o in
qualche altro file. Vale solo per l'esecuzione in corso; a quella dopo,
la si ridigita (o si preme Invio per usare quella già configurata, se
c'è una).

**Nessuna scrittura sul repository.** Gli agenti producono solo oggetti
`Proposal`, e `pr_link` resta sempre `None`. Il campo esiste già nel
modello apposta: quando arriverà l'integrazione con GitHub, non servirà
toccare il contratto dati.

**I prompt vivono fuori dal codice.** Stanno in `prompts/*.md`, con sezioni
`[SYSTEM]` e `[USER]`. Ogni agente ha il proprio file, così tre sviluppatori
diversi non si trovano mai a modificare le stesse righe.

**AWS è sostituito, non rimosso.** `AnthropicProvider` è solo una delle
possibili realizzazioni di `LLMProvider`. Quando AWS tornerà disponibile,
aggiungere `BedrockProvider` significherà aggiungere una classe e una riga
in `build_provider` — niente di più.

> **Nota di sicurezza (RS.4).** Usando l'API Anthropic diretta, va scelto un
> livello di servizio che garantisca che il codice sorgente analizzato non
> venga conservato né usato per addestrare modelli di terze parti.

## Comportamento in caso di errore

Il grafo non solleva mai eccezioni: qualsiasi errore finisce dentro il
`Report`, con `status: "fallito"` e un `error.type` che vale `timeout`,
`parse` oppure `context_missing`. La CLI restituisce un codice d'uscita
diverso da zero in questo caso, il che torna utile in una pipeline CI.

## Stato della verifica

- 62 test, tutti verdi, eseguiti senza toccare la rete.
- Copertura dei moduli core: circa il **92%** (l'obiettivo RQ.5 era ≥ 75%).
- Il diff prodotto dall'agente Docs è stato verificato applicandolo davvero,
  con `patch`.

## Cosa manca (deliberatamente)

Per l'agente Docs: il README di progetto e la documentazione delle API. Per
l'agente OWASP: la variante policy-as-code — il loader la supporta già
(legge `CLAUDE.md`), ma le manca ancora un proprio template di prompt. Per
l'agente Changelog: il changelog rivolto al business, che è un secondo
passaggio sull'esito tecnico già prodotto.
