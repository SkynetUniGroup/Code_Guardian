# Guida alla suite di test — Code Guardian PoC

Questo documento spiega **cosa** verifica la suite di test del progetto, **quali
risultati aspettarsi** e **quali sono stati ottenuti**, senza dover leggere il codice
dei test. Per i comandi da usare per rieseguirli, vedi la sezione
["Running the automated tests"](README.md#running-the-automated-tests) del `README.md`
— qui invece si spiega il *contenuto*.

Ultima esecuzione verificata: **2026-08-20**, rieseguita dal vivo (non da cache/memoria)
in locale (backend/agents/frontend) e in Docker (E2E Jest + Playwright), con i comandi
documentati nel README.

## Indice

- [Riepilogo](#riepilogo) — tabella con tutti i numeri
- Cosa verifica ogni file: [Backend](#backend-nestjs-jest), [Agents](#agents-python-pytest), [Frontend](#frontend-react-vitest)
- [Test E2E del backend](#test-e2e-del-backend-jestsupertest-contro-mongoredis-reali) e [Test di Sistema/Accettazione (Playwright)](#test-di-sistema-e-accettazione-e2e-reali-playwright)
- [Bug reali trovati scrivendo questi test](#bug-reali-trovati-scrivendo-questi-test)
- <a href="#gap-ts-ta">Stato dei 105 Test di Sistema + 13 di Accettazione del PdQ</a> — cosa manca per essere "esaustivi" secondo il Piano di Qualifica
- [Cosa resta da fare](#cosa-resta-da-fare)
- [Cronologia degli aggiornamenti](#cronologia-degli-aggiornamenti) — changelog sessione per sessione

---

## Riepilogo

| Livello | File di test | Test totali | Esito | Copertura |
|---|---|---|---|---|
| **Backend** (NestJS/Jest) | 25 | 153 | ✅ 153/153 | 94% istruzioni, 85% branch, 95% funzioni |
| **Backend E2E** (Jest+Supertest, stack Docker reale: Mongo+Redis) | 1 | 4 | ✅ 4/4 | n/d |
| **Agents** (Python/pytest) | 20 | 113 | ✅ 112 passati, 1 skippato (volontario) | 94% combinata (100% su `security.py`) |
| **Frontend** (React/Vitest) | 9 | 90 | ✅ 90/90 (isolato — vedi nota sotto su falsi negativi sotto carico) | 100% su tutti i file sostanziali |
| **E2E di Sistema/Accettazione** (Playwright, reali) | 7 | 12 | ✅ 12/12 (in serie) | n/d — non misura coverage di codice |
| **Totale** | 62 | 372 | ✅ 371 passati, 1 skippato | — |

Nessun test è disabilitato/marcato "todo" nascosto: l'unico test non eseguito di default
è `test_golden_set_accuracy.py` (vedi sotto), e non è un fallimento nascosto: richiede
volutamente una vera chiamata LLM, quindi non gira senza una `LLM_API_KEY` reale.


---

<a id="backend-nestjs-jest"></a>
## Backend (NestJS / Jest)

25 file, 153 test. Test di unità/integrazione con dipendenze esterne (HTTP, MongoDB,
GitHub) mockate: il codice vero sotto test gira per intero, solo i confini con
l'esterno sono finti.

### Autenticazione e sicurezza interna
| File | Cosa verifica |
|---|---|
| `jwt.strategy.spec.ts` | Validazione dei token JWT di sessione |
| `auth.controller.spec.ts` | Endpoint di login (stub, no registrazione vera nel PoC) |
| `hmac.guard.spec.ts` | Firma HMAC che autentica le chiamate interne agents→backend |
| `hmac.guard.config-edge-cases.spec.ts` | Comportamento della guardia HMAC quando la configurazione (segreto) manca |
| `internal-github.controller.spec.ts` | Endpoint interni whitelisted usati dagli agenti Python per leggere GitHub |

### Credenziali
| File | Cosa verifica |
|---|---|
| `credential-vault.service.spec.ts` | Cifratura/decifratura (AES-256-GCM) dei token utente prima del salvataggio — round trip reale, il testo cifrato non contiene mai il segreto in chiaro (**RS.2**) |
| `credentials.controller.spec.ts` | Endpoint di salvataggio delle credenziali GitHub |

### Repository e GitHub
| File | Cosa verifica |
|---|---|
| `github-client.service.spec.ts` | Client Octokit: chiamate base verso le API GitHub |
| `github-client.service.read-operations.spec.ts` | Letture (albero file, contenuti, issue) |
| `repository-context.service.spec.ts` | Costruzione del contesto di analisi: risoluzione ref→SHA, mapping errori GitHub (404→NotFound, 401/403→BadRequest), rilevamento linguaggi, limite di 100 file (**RF.31**) |
| `repositories.controller.spec.ts` | Endpoint pubblico di selezione repository |
| `context.controller.spec.ts` | Endpoint pubblico di creazione contesto |

### Orchestrazione ed esecuzione task
| File | Cosa verifica |
|---|---|
| `orchestrator.service.spec.ts` | Instradamento operazione→agente puramente deterministico, nessuna logica LLM nel percorso, propaga (non inghiotte) l'errore per operazioni non mappate (**RV.1**) |
| `agent.registry.spec.ts` | Mappa statica codice-operazione→agente |
| `agent-gateway.service.spec.ts` | Chiamata HTTP verso il servizio Python; conversione di timeout/errori upstream in eccezioni codificate |
| `task-queue.service.spec.ts` | Accodamento dei job (BullMQ/Redis) |
| `task.processor.spec.ts` | Cancellazione cooperativa di una task in corso |
| `task.processor.execution-flow.spec.ts` | Ciclo di vita completo di una task: PENDING→RUNNING→COMPLETED/FAILED, contesto mancante, payload parziali dall'agente, corse critiche (task cancellata mentre l'agente sta ancora rispondendo), completamento di un batch |
| `task.schema.spec.ts` | Macchina a stati delle transizioni permesse (es. da uno stato terminale nessuna transizione è ammessa) |

### Report e API pubbliche
| File | Cosa verifica |
|---|---|
| `report.service.spec.ts` | Logica di persistenza/lettura dei report |
| `report.controller.spec.ts` | Endpoint pubblico di recupero report |
| `mongo-serialize.interceptor.spec.ts` | Serializzazione corretta degli `_id` di Mongo nelle risposte JSON |
| `task.controller.spec.ts` | Endpoint di cancellazione task |
| `task.controller.creation-and-queries.spec.ts` | Endpoint di creazione e interrogazione task |
| `events.gateway.spec.ts` | Eventi WebSocket di avanzamento/completamento inviati al frontend |

> **Nota sulla copertura:** il 94%/85% aggregato include 3 schemi Mongoose dichiarativi
> (`user.schema.ts`, `access-log.schema.ts`, `service-credential.schema.ts` — solo campi,
> nessuna logica) che risultano allo 0% perché non ancora collegati all'app in questo PoC
> (vedi "Project scope" nel README: niente registrazione/multi-utente reale ancora). Non
> è un gap di test reale — non c'è comportamento da testare in quei file.

---

<a id="agents-python-pytest"></a>
## Agents (Python / pytest)

20 file, 113 test (112 passati + 1 skip volontario).

### Motore comune (LangGraph)
| File | Cosa verifica |
|---|---|
| `test_graph_sequencing_and_happy_path.py` | Sequenza nominale del grafo: carica_contesto→componi_prompt→invoca_llm→valida_e_parsa |
| `test_graph_errors.py` | Un JSON malformato dall'LLM diventa un `Report` FAILED, non un crash |
| `test_graph_node_level_error_handling.py` | Cattura delle eccezioni a livello di singolo nodo del grafo |
| `test_graph_retry_loop.py` | Fino a 2 tentativi di autocorrezione se il parsing fallisce, poi fallimento definitivo |
| `test_graph_routing_logic.py` | Instradamento condizionale tra i nodi del grafo |
| `test_graph_timeout_and_fallback_handling.py` | Gestione delle eccezioni globali (timeout) del grafo |
| `test_graph_tool_loop_integration.py` | Loop reale `invoca_llm` ↔ `esegui_tools` (uso effettivo del `ToolNode` di LangGraph) |
| `test_cancellation.py` | Cancellazione cooperativa: il grafo si ferma se il flag su Redis è alzato |

### I tre agenti
| File | Cosa verifica |
|---|---|
| `test_docs_agent.py` | Agente Docs — operazione `DOCS_INLINE` |
| `test_security_parser.py` | Parsing dell'output LLM in `FindingBlock` (categoria OWASP, gravità, file, remediation); ordinamento dei finding per gravità (**TU_11**); scarto dei finding fuori ambito/allucinati (**TU_10**) |
| `test_security_loader_and_policy_parser.py` | Caricamento/parsing del file `POLICY.md` per l'analisi policy-as-code; normalizzazione della remediation in tutti i formati (**TU_09**) |
| `test_changelog_agent.py` | Agente Changelog — operazione `CHANGELOG_TECHNICAL` |

### Provider LLM
| File | Cosa verifica |
|---|---|
| `test_llm_provider_factory.py` | Factory `get_llm_provider()` e selezione del provider configurato |
| `test_llm_managed_provider_internals.py` | Dettagli interni di `ManagedAPIProvider` |
| `test_golden_set_accuracy.py` | **Skippato di default** — misura l'accuratezza reale (**RQ.5**, ≥85%) su un caso noto-vulnerabile, ma chiama davvero l'LLM: gira solo con `LLM_API_KEY` impostata, e solo dentro la rete Docker (vedi [Cronologia](#cronologia-degli-aggiornamenti)). Con entrambe le condizioni soddisfatte: **passa** (**TI_04**) |

### Prompt
| File | Cosa verifica |
|---|---|
| `test_base_prompt_loading.py` | Caricamento dei template YAML esterni |
| `test_prompt_rendering.py` | Il template YAML viene diviso correttamente in prompt di sistema/utente |
| `test_prompt_isolation.py` | Test statico (analisi AST del codice Python): fallisce se trova stringhe letterali troppo lunghe nel codice — garantisce che i prompt vivano nei file YAML e non nel codice (**metrica MPD_14 del PdQ**) |

### API e sicurezza verso il backend
| File | Cosa verifica |
|---|---|
| `test_main_api_endpoints.py` | Endpoint FastAPI esposti dal servizio agents |
| `test_github_toolset_hmac_signing.py` | Firma HMAC delle chiamate che gli agenti fanno verso gli endpoint interni del backend |

---

<a id="frontend-react-vitest"></a>
## Frontend (React / Vitest)

9 file, 90 test. Ogni chiamata di rete (API REST, WebSocket) è mockata: nessun
backend/Docker necessario.

| File | Cosa verifica |
|---|---|
| `components/Layout.test.tsx` | Struttura/navigazione comune dell'app |
| `components/ReportRenderer.test.tsx` | Rendering dei blocchi del report (testo, finding, snippet, link a PR) |
| `hooks/useWebSocket.test.ts` | Connessione WebSocket e ricezione eventi di avanzamento task |
| `pages/Setup.test.tsx` | Pagina di configurazione token GitHub |
| `pages/RepositorySelection.test.tsx` | Form di selezione repository/ambito, avvio analisi, gestione errori |
| `pages/TaskExecution.test.tsx` | Pagina di monitoraggio avanzamento task |
| `pages/ReportView.test.tsx` | Visualizzazione del report completo |
| `stores/useAppStore.test.ts` | Stato globale dell'app (Zustand) |
| `utils/api.test.ts` | Funzioni di chiamata al backend |

---

## Test E2E del backend (Jest+Supertest contro Mongo+Redis reali)

`backend/test/end-to-end.spec.ts` (comando `npm run test:e2e`, config
`backend/test/jest-e2e.json`) è un secondo livello di test, distinto dagli unit test in
`backend/src/`: monta l'`AppModule` NestJS per intero con `Test.createTestingModule`, e
mocka **solo i veri confini esterni** (guardia JWT, client GitHub, gateway verso l'agente
Python, coda BullMQ) — Mongoose, i controller, il `TaskProcessor` e la macchina a stati
girano nel loro codice reale, scrivendo/leggendo da un vero MongoDB. Copre in 4 passi
l'intero ciclo: creazione contesto → creazione task → esecuzione da parte del
`TaskProcessor` → lettura del report salvato, con assert sui valori effettivi (status,
categoria OWASP, severity) e non solo sull'HTTP status code (**TI_05** nel PdQ).

**Non gira con un semplice `npm test`** perché `MONGO_URI`/`REDIS_URL` sono validati come
obbligatori (Joi) nell'`AppModule` e, nel `.env` del progetto, puntano agli hostname
Docker interni `mongo`/`redis` (Redis non ha nemmeno una porta esposta sull'host, per
scelta esplicita) — va quindi eseguito **dentro** la rete Docker, non dall'host:

```bash
docker compose up -d          # se lo stack non è già in esecuzione
docker exec poc-backend-1 sh -c "cd /app/backend && npx jest --config ./test/jest-e2e.json --runInBand"
```

Verificato **2026-08-20**: 4/4 passati (~25s). Nota: scrive un Task e un Report reali
nel MongoDB dello stack di sviluppo (`codeguardian.tasks`/`.reports`, `userId:
'user-123'`) — dato di test, non pericoloso, ma da tenere presente se si ispeziona il DB
a mano.

---

## Test di Sistema e Accettazione (E2E reali, Playwright)

7 file, 12 test. A differenza di tutto il resto di questo documento, questi **non sono
mock**: girano nel browser contro lo stack Docker Compose realmente in esecuzione
(frontend + backend + MongoDB + Redis + agents), con chiamate vere a GitHub e all'LLM
configurato. Colmano (in parte) il gap TS/TA descritto più sotto. Vivono in
`frontend/e2e/`, comando `npm run test:e2e` (richiede `docker compose up -d` e
`E2E_GITHUB_PAT` nel `.env`). **Un solo worker** (`workers: 1` in
`playwright.config.ts`): in parallelo si osservano interferenze reali (stesso
backend/DB/token condivisi), non bug applicativi.

> ⚠️ **Il servizio `agents` in Docker non è montato in bind**: è costruito da immagine.
> Modificare il codice sorgente in `agents/src/` **non ha alcun effetto** sui container
> già in esecuzione finché non si ricostruisce l'immagine e si riavvia il servizio:
> ```bash
> docker compose build agents && docker compose up -d agents
> ```
> Dimenticarlo porta a "verificare" involontariamente il codice vecchio.

| File | Copre | Repository/Ambito usato | Esito |
|---|---|---|---|
| `setup.spec.ts` | RF.10, RF.11 — salvataggio PAT, redirect automatico a `/setup` | — (nessun GitHub reale necessario) | ✅ |
| `security-analysis.spec.ts` | TA_09, RF.15/25/40/44/53/54/60-64/87-91 — scansione OWASP completa | `OWASP/NodeGoat` (`app/routes/`) | ✅ — trova findings reali |
| `docs-analysis.spec.ts` | RF.83-85, RF.63 — documentazione inline, diff proposto | `OWASP/NodeGoat` (`app/routes/`) | ✅ |
| `changelog-analysis.spec.ts` | RF.94-97 — changelog tecnico da Issue reali | `SkynetUniGroup/Code_Guardian` (`Website/`) | ✅ (vedi nota sotto) |
| `repository-errors.spec.ts` (test 1) | RF.20/UC11 — repository inesistente | owner/nome inventati | ✅ |
| `repository-errors.spec.ts` (test 2) | RF.31/UC19 — limite di 100 file superato | `OWASP/NodeGoat` intero (111 file) | ✅ |
| `security-policy-analysis.spec.ts` (test 1) | RF.92/93 — verifica POLICY.md, trova violazioni reali | `IlGranz/codeguardian-e2e-fixture` (repo di prova creato apposta, vedi sotto) | ✅ — trova le 4 violazioni intenzionali |
| `security-policy-analysis.spec.ts` (test 2) | RF.70/UC27.5 — POLICY.md assente | `OWASP/NodeGoat` (`app/routes/`) | ✅ |
| `reference-errors-and-scope.spec.ts` (×4) | RF.21/22 (ref inesistente), RF.26 (intero repo), RF.27 (ambito = singolo file), RF.30/UC18 (directory inesistente) | `OWASP/NodeGoat` + `IlGranz/codeguardian-e2e-fixture` | ✅ |

**Perché `OWASP/NodeGoat`** per Security/Docs: è un'app Node.js scritta apposta
dall'OWASP con vulnerabilità didattiche reali — verifica che l'agente trovi davvero
qualcosa, non solo che "non vada in errore". **Perché non il vostro repo per quei due**:
l'intero `Code_Guardian` supera il limite di 100 file (293), utile invece proprio per
testare RF.31.


---

## Bug reali trovati scrivendo questi test

Non solo "test verdi" — scrivere ed eseguire questi test ha trovato problemi reali nel
codice. Ogni voce indica l'area coinvolta e se è già stata corretta.

1. **Frontend**, `RepositorySelection.test.tsx` (test "REGRESSIONE"): il componente
   scriveva lo stato della task appena creata come `'pending'` minuscolo invece di
   `'PENDING'`. Effetto reale: la pagina di esecuzione non mostrava la barra di
   avanzamento finché non arrivava il primo evento WebSocket a correggere lo stato.
   ✅ **Corretto.**
2. **Agents**, `agents/src/llm.py` — `BedrockProvider` non implementa il metodo astratto
   `invoke_agent`: istanziarlo solleva un generico `TypeError` di Python invece del
   `NotImplementedError` con messaggio esplicativo che era l'intenzione del codice
   (codice morto in `__init__`). ⏳ *Non ancora corretto.*
3. **Agents**, `agents/src/graph.py` — l'arco `componi_prompt → invoca_llm` è
   incondizionato (a differenza di `carica_contesto`, che controlla `_route` prima): un
   prompt troppo grande o non valido genera comunque una chiamata LLM sprecata prima che
   l'errore preesistente venga intercettato da `_route_llm_output`. L'esito finale del
   Report resta comunque corretto. ⏳ *Non ancora corretto (impatto: solo spreco di una
   chiamata LLM in un caso limite, non un bug funzionale).*
4. **Frontend** — RF.98 non implementato: il backend/agente supportano un campo
   opzionale `sprintId` per l'Agente Changelog (`context.dto.ts`), ma **nessuna pagina
   del frontend espone un campo per inserirlo** (UC41.1 assente). Da UI,
   `CHANGELOG_TECHNICAL` gira sempre col default (tutte le Issue chiuse, non filtrate
   per sprint). Trovato scrivendo `changelog-analysis.spec.ts`.
5. **Agents**, `agents/src/agents/changelog.py:16` — dead code innocuo: il fallback
   `getattr(context_ref, "sprint_id", "Current Sprint")` non scatta mai, perché il
   modello Pydantic in `main.py:25` valorizza sempre `sprint_id` con un default proprio
   (`"Sprint Attuale"`). Nessun impatto funzionale, solo codice fuorviante da pulire.
6. ⚠️ **Backend**, `internal/github-client.service.ts:93` — troncamento GitHub non
   gestito (**il più significativo trovato**): `getTree()` chiama l'API GitHub con
   `recursive: 1` ma non controlla mai il flag `truncated` che GitHub restituisce per
   repository molto grandi. Riprodotto su un repository pubblico reale
   (`keldaanCommunity/pokemonAutoChess`, 64.205 nodi restituiti, `truncated: true`):
   l'albero file arriva **silenziosamente incompleto**, e nel nostro caso questo ha
   causato un falso errore "POLICY.md non trovato" per un file che esiste per davvero
   alla radice del repository. Impatto più ampio: su repository grandi, file reali
   possono essere esclusi dall'analisi di Docs/Security senza alcun avviso all'utente —
   un problema di correttezza silenziosa, non solo un errore cosmetico. ⏳ *Non ancora
   corretto.*
7. **Frontend** — `TaskExecution.tsx` non mostra quale operazione è in corso: la pagina
   di monitoraggio (RF.45) mostra solo lo stato (`PENDING`/`RUNNING`/...), mai il tipo di
   operazione (`SECURITY_OWASP`, `DOCS_INLINE`, ...) né il nome del repository. Chi
   avvia più analisi in sequenza non ha modo di distinguerle finché non apre il report.
8. **Frontend** — l'header del report non mostra repo/ref/ambito/durata (RF.55-57):
   `ReportView.tsx` mostra solo tipo operazione, data/ora e stato — non il repository
   analizzato, il riferimento di base, l'ambito selezionato, né il tempo di esecuzione,
   pur essendo tutti dati già presenti nel modello.
9. **Frontend** — nessun comando per la traduzione "business" del Changelog
   (RF.103-105): il report tecnico del Changelog non mostra alcun pulsante "Accetta e
   genera Business" descritto in UC45 — la seconda metà del flusso Changelog è
   irraggiungibile da UI.
10. **Backend** — `createContext` valida sempre file/linguaggio anche per operazioni che
    non leggono codice: l'Agente Changelog legge solo Issue GitHub, eppure la creazione
    del contesto applica comunque i controlli RF.24/RF.31 sull'ambito file. Scoperto
    perché l'intero repository `Code_Guardian` (293 file) supera il limite anche per un
    test Changelog, che non ne avrebbe bisogno — richiede uno scope "finto" solo per
    superare la validazione. Comportamento discutibile più che un bug, ma vale la pena
    rivalutarlo in fase di progettazione PB.
11. **Agents** (nel test stesso) — `test_golden_set_accuracy.py` non passava mai: il
    `fake_context` impostava `scopeType="FILES"` senza il corrispondente campo `paths`.
    `SecurityLoader.load()` (`agents/src/agents/security.py`) filtra i file per
    `scopeType` diverso da `FULL_REPOSITORY` tramite
    `any(path.startswith(p) for p in paths)` — con `paths` assente (`[]` di default), il
    filtro scarta sempre l'unico file finto restituito dal toolset, sollevando "Nessun
    file sorgente trovato" prima ancora di interpellare l'LLM (`report.status ==
    "FAILED"`, indipendentemente dall'accuratezza reale del modello). Il PdQ marcava
    questo test (TI_04) come "S" senza che fosse mai stato eseguito con successo.
    ✅ **Corretto**: `scopeType="FULL_REPOSITORY"` nel fixture. Riverificato: il test ora
    passa davvero, con una chiamata LLM reale che identifica correttamente la SQL
    Injection.

---

<a id="gap-ts-ta"></a>
## Stato completo dei 105 Test di Sistema + 13 Test di Accettazione (PdQ)

Triage riga per riga di **tutto** il catalogo TS_1–105/TA_01–13 del Piano di Qualifica,
fatto per rispondere in modo onesto a "fateli tutti": molti non sono scrivibili perché la
funzionalità **non esiste in questo PoC**, non perché manchi il test. Marcarli "da fare"
sarebbe fuorviante — qui invece ogni riga ha uno stato reale, pronto per essere
trascritto nella tabella del PdQ vero.

**Legenda**: ✅ **S** = Superato (testato qui, con riferimento al test) · 🚫 **N/A** =
Non Applicabile, funzionalità assente in questo PoC (motivo indicato) · ⏳ **NI** = Non
Implementato/testato, ma teoricamente possibile (motivo/nota).

**Riepilogo**: 12 test E2E coprono **32 requisiti a stato S** (alcuni parziali,
indicati). **~50 sono N/A** (funzionalità fuori scope di questo PoC — non un
fallimento). **~23 restano NI** (teoricamente testabili, non fatto in questa sessione:
richiedono scenari costosi/rischiosi da riprodurre — timeout LLM reale, esaurimento
rate limit — o semplicemente non sono stati prioritari finora).

<details>
<summary><b>Tabella completa RF.1–RF.105 (click per espandere)</b></summary>

| RF | Stato | Nota |
|---|---|---|
| RF.1-9 | 🚫 N/A | Registrazione/login reali non implementati (solo stub login automatico) |
| RF.10 | ✅ S | `setup.spec.ts` |
| RF.11 | ✅ S | `setup.spec.ts` |
| RF.12 | 🚫 N/A | Nessun campo token Task Management in UI |
| RF.13 | 🚫 N/A | Endpoint di validazione esiste (`POST /credentials/:id/validate`) ma non è mai chiamato dal frontend |
| RF.14 | 🚫 N/A | Nessuna validazione sintattica del token lato client |
| RF.15 | ✅ S | Tutti i test che avviano un'analisi |
| RF.16 | ⚠️ S-parziale | Owner+nome sì (non un URL singolo); selettore tipo riferimento (branch/PR) assente |
| RF.17 | ⚠️ S-parziale | Un unico campo "Ref" generico, non due campi branch+commit distinti come da AdR |
| RF.18 | 🚫 N/A | Nessun selettore "Pull Request" come riferimento |
| RF.19 | 🚫 N/A | Non c'è un campo URL singolo da validare (owner/nome sono campi liberi separati) |
| RF.20 | ✅ S | `repository-errors.spec.ts` |
| RF.21 | ✅ S | `reference-errors-and-scope.spec.ts` (ref generico, vedi nota nel file) |
| RF.22 | ⚠️ S-parziale | Stesso test di RF.21 — l'UI non distingue branch da commit |
| RF.23 | 🚫 N/A | Nessun selettore PR |
| RF.24 | ⚠️ S-parziale | Il blocco "zero linguaggi supportati" è testato; l'avviso *non bloccante* per repository a linguaggi misti (UC15) non è implementato separatamente |
| RF.25 | ✅ S | Onnipresente |
| RF.26 | ✅ S | `reference-errors-and-scope.spec.ts` |
| RF.27 | ✅ S | `reference-errors-and-scope.spec.ts` |
| RF.28 | ✅ S | Onnipresente (es. `app/routes`) |
| RF.29 | 🚫 N/A | Nel PoC lo scope vuoto è valido (= intero repository), non produce un blocco come da UC17 |
| RF.30 | ✅ S | `reference-errors-and-scope.spec.ts` |
| RF.31 | ✅ S | `repository-errors.spec.ts` |
| RF.32 | ✅ S | Onnipresente |
| RF.33 | ✅ S | Onnipresente |
| RF.34 | 🚫 N/A | Il backend non fornisce nemmeno una descrizione per operazione (solo `code`+`name`) |
| RF.35 | ✅ S | Onnipresente |
| RF.36 | 🚫 N/A | Select singola, non multi-selezione con toggle |
| RF.37 | 🚫 N/A | Nessuna selezione multipla |
| RF.38 | 🚫 N/A | Nessun controllo email in UI |
| RF.39 | 🚫 N/A | Nessun avvio multiplo |
| RF.40 | ✅ S | Verificato indirettamente: ogni test ottiene il report dell'agente corretto; anche `backend/test/end-to-end.spec.ts` |
| RF.41 | ✅ S | Il pulsante "Avvia Analisi" è disabilitato senza operazione selezionata (precondizione di ogni test) |
| RF.42 | ⚠️ S-parziale | Bloccato via `required` HTML nativo, non un messaggio applicativo esplicito |
| RF.43 | ⚠️ S-parziale | Monitoraggio di una singola task sì; non è una "dashboard" multi-operazione (RF.36-39 assenti) |
| RF.44 | ✅ S | Tutti i test che attendono "Analisi completata!" via WebSocket |
| RF.45 | 🚫 N/A | `TaskExecution.tsx` non mostra il nome/tipo dell'operazione, solo lo stato — vedi bug #7 |
| RF.46 | ✅ S | PENDING/RUNNING/COMPLETED/FAILED tutti osservati; CANCELLED non testato in E2E |
| RF.47 | ✅ S | Il link al report appare solo dopo COMPLETED, verificato ovunque |
| RF.48 | ⏳ NI | Coperto a livello unit/integration (`task.processor.execution-flow.spec.ts`); isolamento sotto vera concorrenza non testato in E2E |
| RF.49-52 | 🚫 N/A | Nessuna pagina di storico report |
| RF.53 | ✅ S | Onnipresente |
| RF.54 | ✅ S | Onnipresente |
| RF.55 | 🚫 N/A | Il nome del repository non è mostrato nell'header del report — vedi bug #8 |
| RF.56 | 🚫 N/A | Riferimento base e ambito non mostrati nell'header — vedi bug #8 |
| RF.57 | 🚫 N/A | Tempo di esecuzione non mostrato — vedi bug #8 |
| RF.58 | ✅ S | Data+ora di generazione mostrate insieme (`generatedAt`) |
| RF.59 | ✅ S | Verificato (blocchi di testo nei report) |
| RF.60 | ✅ S | Liste di finding/violazioni renderizzate |
| RF.61 | ✅ S | `test_security_parser.py` (TU_11, ordinamento); dato presente e corretto anche in E2E via query diretta a MongoDB |
| RF.62 | ⚠️ S-indiretto | Dato presente e corretto (verificato via query diretta a MongoDB), non asserito esplicitamente visibile nel DOM in E2E |
| RF.63 | 🚫 N/A | Il PoC non crea mai una vera Pull Request (scelta di scope dichiarata nel README) |
| RF.64 | 🚫 N/A | Nessun modulo di validazione/avanzamento in UI (dipende da RF.103, assente) |
| RF.65 | ✅ S | Più test di errore |
| RF.66 | ⏳ NI | Richiederebbe esaurire deliberatamente un limite di chiamate reale — rischioso/costoso da provocare |
| RF.67 | ⏳ NI | Coperto a livello agents/backend unit test; non riprodotto in E2E reale |
| RF.68 | ⏳ NI | Idem |
| RF.69 | ⏳ NI | Idem (limiti a runtime, distinti dal pre-check RF.31 già testato) |
| RF.70 | ✅ S | `security-policy-analysis.spec.ts` |
| RF.71 | 🚫 N/A | Nessuna validazione strutturale di POLICY.md nel codice — qualunque contenuto viene passato all'LLM as-is |
| RF.72 | 🚫 N/A | Nessuna PR viene mai creata |
| RF.73-74 | 🚫 N/A | Nessun export PDF |
| RF.75-78 | 🚫 N/A | Nessuna notifica email |
| RF.79-81 | 🚫 N/A | Nessuna UI per template README personalizzato |
| RF.82 | 🚫 N/A | Operazione di generazione README completa non implementata (solo DOCS_INLINE) |
| RF.83 | ⚠️ S-parziale | `docs-analysis.spec.ts` — "via PR" non si applica (nessuna PR reale) |
| RF.84 | ⏳ NI | Non testato lo scenario specifico di correzione di doc esistente ma obsoleta |
| RF.85 | ⏳ NI | Richiederebbe codice deliberatamente troppo complesso nel repository target |
| RF.86 | 🚫 N/A | Operazione API.md non implementata |
| RF.87 | ✅ S | `security-analysis.spec.ts` |
| RF.88 | ✅ S | Verificato via MongoDB (categoria+gravità popolate) |
| RF.89 | ✅ S | Verificato via MongoDB (`filePath`) |
| RF.90 | ✅ S | Verificato via MongoDB (4 remediation nel test fixture); anche `test_security_loader_and_policy_parser.py` (TU_09) |
| RF.91 | ✅ S | Idem (remediation testuali); anche TU_09 |
| RF.92 | ✅ S | `security-policy-analysis.spec.ts` |
| RF.93 | ⏳ NI | Non verificato che regole non di sicurezza in POLICY.md vengano ignorate |
| RF.94 | ⚠️ S-parziale | `changelog-analysis.spec.ts` — senza filtro sprint reale (RF.98 assente) |
| RF.95 | ✅ S | Verificato via MongoDB |
| RF.96 | ✅ S | `changelog-analysis.spec.ts` |
| RF.97 | ⏳ NI | Non verificato con almeno un task valido incluso (nel test reale tutti erano esclusi) |
| RF.98 | 🚫 N/A | Nessun campo Sprint ID in UI — vedi bug #4, pur essendo supportato dal backend |
| RF.99 | 🚫 N/A | Dipende da RF.98, assente |
| RF.100 | ✅ S | `changelog-analysis.spec.ts` |
| RF.101 | ✅ S | Comportamento di default osservato |
| RF.102 | 🚫 N/A | Nessun prompt di conferma interattivo (esclusione automatica silenziosa) |
| RF.103-105 | 🚫 N/A | Pulsante "Changelog di Business" non implementato in UI — vedi bug #9 |

</details>

<details>
<summary><b>Tabella completa TA_01–13 (click per espandere)</b></summary>

| TA | Stato | Nota |
|---|---|---|
| TA_01 | 🚫 N/A | Registrazione/login reali assenti |
| TA_02 | 🚫 N/A | Task Management assente; validazione token reale non wired |
| TA_03 | ✅ S | Coperto ampiamente (selezione repo/ref/ambito + controlli) |
| TA_04 | 🚫 N/A | Nessuna selezione/avvio multiplo |
| TA_05 | ⏳ NI | Monitoraggio dinamico sì; isolamento sotto vera concorrenza non testato in E2E |
| TA_06 | 🚫 N/A | Nessuna UI per template README |
| TA_07 | 🚫 N/A | Generazione README completa non implementata; nessuna PR reale |
| TA_08 | ⚠️ S-parziale | Inline sì; esclusione codice complesso e PR non applicabili |
| TA_09 | ✅ S | `security-analysis.spec.ts` |
| TA_10 | ⚠️ S-parziale | Assenza POLICY.md sì; malformazione non applicabile (nessuna validazione strutturale) |
| TA_11 | 🚫 N/A | Nessuna notifica email |
| TA_12 | ⚠️ S-parziale | Parte tecnica sì; traduzione business non implementata in UI |
| TA_13 | 🚫 N/A | Nessuno storico, nessun export PDF |

</details>

## Cosa resta da fare

Vedi la tabella completa sopra per lo stato riga per riga di tutti i 118 TS/TA. In
sintesi, oltre alle righe marcate ⏳ NI:

- **Cancellazione cooperativa di una task in corso** a livello di interfaccia (esiste ed
  è testata a livello backend/agents — vedi tabelle sopra — ma non end-to-end dal
  browser: non c'è alcun pulsante "Annulla" in `TaskExecution.tsx`).
- I gap di UI elencati nella sezione ["Bug reali trovati"](#bug-reali-trovati-scrivendo-questi-test)
  (voci #4, #7, #8, #9) sono la cosa più utile da guardare per chi deve decidere cosa
  implementare nella fase PB.

---
