# Test end-to-end (Playwright)

Sono i Test di Sistema (TS_*) e di Accettazione (TA_*) del Piano di Qualifica.
Girano nel browser contro lo **stack reale** — frontend, backend, MongoDB,
Redis, MinIO e il servizio agenti — non contro mock, e **non avviano nulla da
soli**: lo stack deve essere già in esecuzione.

## Prerequisiti

```bash
cd Src/MVP
docker compose up -d                    # stack completo
```

Il frontend servito da Docker è su `http://localhost:5173`, che è il `baseURL`
configurato. Se invece si sviluppa fuori da Docker, il frontend va avviato
dicendogli dove sta il backend, altrimenti il proxy di Vite punta a un hostname
che esiste solo nella rete Docker:

```bash
cd Src/MVP/backend  && pnpm run start:dev
cd Src/MVP/frontend && BACKEND_URL=http://localhost:3000 pnpm run dev -- --host
```

## Variabili d'ambiente

Lette dal `.env` alla radice di `Src/MVP` (lo stesso che usano backend e
agenti).

| Variabile | Serve a | Se manca |
|---|---|---|
| `E2E_GITHUB_PAT` | tutti gli spec che raggiungono GitHub | i test si saltano da soli, non falliscono |
| `OPENAI_API_KEY` (o le credenziali Bedrock) | i soli spec marcati `@agent` | l'agente fallisce e il test con lui |

Un PAT in sola lettura su repository pubblici è sufficiente: nessuno spec
scrive sui repository di prova. L'unica scrittura possibile è la Pull Request
aperta da `DOCS_INLINE`, e il relativo caso accetta come esito valido anche
l'avviso di pubblicazione fallita.

## Esecuzione

```bash
cd Src/MVP/frontend
npx playwright test                       # tutti i browser
npx playwright test --project=chromium    # solo Chromium
npx playwright test --grep-invert @agent  # salta gli spec che avviano un agente
```

## I file

| Spec | Copre | Richiede PAT | Richiede LLM |
|---|---|---|---|
| `registration-and-roles.spec.ts` | TS_02-TS_09 — registrazione, ruolo operativo, accesso e rifiuto | no | no |
| `credentials-management.spec.ts` | TS_12, TS_13, TS_14 — inserimento e verifica del token | parziale | no |
| `template-readme.spec.ts` | TS_79, TS_80, TS_81 — caricamento, validazione e rimozione del template | no | no |
| `performance.spec.ts` | TS_110, TS_111 — i due tetti di 2 secondi | no | no |
| `agent-errors.spec.ts` | TS_66-TS_71, TS_109 — errori del modello iniettati sulla risposta | sì | no |
| `context-references.spec.ts` | TS_19 — validazione locale dell'URL del repository | sì | no |
| `operations-and-launch.spec.ts` | TS_34, TS_36, TS_37, TS_39, TS_45, TS_48 — scelta e avvio | sì | parziale |
| `reports-archive.spec.ts` | TS_49-TS_57, TS_64, TS_73, TS_74 — archivio, intestazione, esportazione | parziale | parziale |
| `changelog-flow.spec.ts` | TS_86, TS_99, TS_102-TS_105, TS_108 — flusso del Changelog e docs API | sì | sì |
| `auth-and-credentials.spec.ts` | RF.10, RF.11 — registrazione, login, guardia sulle credenziali, validazione del PAT | parziale | no |
| `repository-errors.spec.ts` | RF.20, RF.21, RF.22, RF.29 — errori nella creazione del contesto | sì | no |
| `reference-errors-and-scope.spec.ts` | RF.17, RF.24, RF.26, RF.27, RF.30 — riferimento e ambito | sì | no |
| `docs-analysis.spec.ts` | RF.63, RF.72, RF.82, RF.83-85 — proposta di diff e apertura PR | sì | sì |
| `security-analysis.spec.ts` | TA_09, RF.53, RF.54, RF.60/61, RF.87-91 — scansione OWASP | sì | sì |
| `security-policy-analysis.spec.ts` | RF.70, RF.92, RF.93 — verifica POLICY.md, presente e assente | sì | sì |
| `changelog-analysis.spec.ts` | RF.94-98 — changelog tecnico dalle Issue, con Sprint ID | sì | sì |

### I casi saltati

Un caso marcato `test.skip` ha bisogno di una precondizione che qui manca — di
norma `E2E_GITHUB_PAT`, oppure una chiave del modello per i casi `@agent`. Il
codice c'è e in un ambiente completo il test gira.

### Navigare negli spec

Mai con `page.goto` verso una rotta autenticata. La sessione vive solo in
memoria — mai in `localStorage`, per scelta dichiarata in `sessionStore` — e un
ricaricamento disautentica, facendo finire sul login. Si usa l'helper `vaiA`,
che clicca la voce della barra laterale: è anche il percorso reale dell'utente.

`helpers.ts` non è uno spec: contiene registrazione, salvataggio del PAT,
creazione del contesto e avvio delle operazioni, cioè i passi che ogni file
ripeterebbe altrimenti.

## Browser

`playwright.config.ts` dichiara Chromium, Firefox ed Edge — è ciò che rende
RV.5 verificabile. I casi marcati `@agent` girano solo su Chromium: avviano
un'analisi vera, e ripeterla su tre motori costerebbe tre chiamate complete
all'LLM per verificare qualcosa che con il browser non ha a che fare.

Su Windows l'avvio di Firefox può fallire con `browserType.launch: spawn
UNKNOWN`: è un problema di configurazione *side-by-side* della macchina, non
del prodotto. Su `windows-latest` e `ubuntu-latest` in CI parte senza problemi.

## Perché gli spec sono stati riscritti

La versione precedente pilotava l'interfaccia del PoC: una schermata `/setup`
con i campi `owner`/`repo` liberi e un pulsante "Salva e Inizia". L'MVP non ha
nessuna di quelle cose — c'è un account vero, una pagina credenziali che
verifica il token contro GitHub, e un elenco a discesa dei repository — quindi
quei file fallivano tutti prima di arrivare a verificare alcunché.
