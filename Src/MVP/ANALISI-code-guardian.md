# Code Guardian — analisi: cosa completare, come testare, stato del codice

_Analisi della cartella `MVP` a fronte del documento `DA-TESTARE-code-guardian.md`._
_Data: 9 settembre 2026._

---

## 0. Prima di tutto: la cartella non è un checkout git

`C:\Users\samue\Desktop\MVP` **non è un repository git** (`.git` assente) e **non contiene `.github/`**.
Il documento `DA-TESTARE` ragiona in termini di rami e di workflow CI
(`pr-check.yml`, `release.yml`): qui non ci sono. Conseguenze pratiche:

- non puoi verificare "8 commit sopra `develop`", né i punti §5.1 / §5.2 (merge con la PR #396,
  pytest che esce con codice 5 in CI): riguardano la CI, non il codice che hai in mano;
- alcune discrepanze minori tra doc e codice sono già state chiuse in questo snapshot
  (es. `agents/tests/integration/` **contiene già** `test_smoke.py`, quindi pytest non esce più con 5);
- se ti serve lavorare sui rami/PR, chiedi un clone vero del repo.

Quello che **puoi** fare qui è tutto il resto: avviare lo stack, eseguire le analisi vere,
far girare le suite di test locali, e chiudere i difetti aperti.

---

## 1. Stato dell'ambiente su questa macchina (blocchi da risolvere)

| Strumento | Richiesto | Presente | Azione |
|---|---|---|---|
| Node | `^26.8.1` (`package.json` → `devEngines`) | **v24.20.0** | Installa Node 26. Con Node 24 `npm`/`npx` nella cartella escono subito con `EBADDEVENGINES`. |
| pnpm | workspace pnpm | **assente** | `npm i -g pnpm@10` (eseguito da una cartella neutra, non da `MVP`). |
| Python | `>=3.12`, target `py312` | **3.14.7** | Le dipendenze degli agenti (`semgrep`, `langgraph-checkpoint-mongodb<0.3`) non sono garantite su 3.14. Usa un venv **3.12**, oppure gira gli agenti solo in Docker. |
| Docker | Compose v2 | **29.6.2 / Compose v5.3.1** | OK. |

`engine-strict=true` in `.pnpmrc`: se un pacchetto dichiara `engines.node`, `pnpm install`
si ferma. Con Node 26 il problema sparisce; in alternativa `pnpm install --config.engine-strict=false`.

**Raccomandazione:** installa Node 26 e usa un venv Python 3.12. È la strada che sblocca sia i
test locali sia gli spec Playwright. Docker copre comunque l'esecuzione runtime.

---

## 2. Cosa fare per completare e testare — in ordine

### Passo 1 — Accendere lo stack

```bash
cd C:\Users\samue\Desktop\MVP
cp .env.example .env
```

Genera i tre segreti (Joi pretende ≥16 caratteri — vedi `backend/src/config/env.validation.ts`):

```bash
node -e "['JWT_SECRET','CREDENTIAL_MASTER_KEY','INTERNAL_SHARED_SECRET'].forEach(k=>console.log(k+'='+require('crypto').randomBytes(32).toString('hex')))"
```

Incollali nel `.env`, poi imposta una `LLM_API_KEY` reale coerente con `LLM_PROVIDER`
(di default `managed` con endpoint DashScope/Qwen; per un'API OpenAI-compatibile lascia
`LLM_PROVIDER` a un valore qualsiasi diverso da `bedrock` e imposta `LLM_BASE_URL`).

```bash
docker compose up -d --build
```

Verifica: frontend `http://localhost:5173`, API `http://localhost:3000/api/v1`,
OpenAPI `http://localhost:3000/api/docs`. Gli agenti non hanno porta sull'host:

```bash
docker compose exec -T backend curl -s http://agents:8000/health
```

Attenzione ai due nomi quasi uguali: `MONGODB_URI` (backend) vs `MONGO_URI` (agenti). Stesso DB.

### Passo 2 — Percorrere un'analisi completa (è LA cosa che manca)

Questa catena non è mai stata attraversata:

```
POST /contexts → POST /tasks → coda BullMQ → TaskProcessor
  → chiamata HMAC agli agents → LangGraph → LLM
  → callback HMAC su /internal/tasks/:id/progress → WebSocket
  → assemblaggio Report → apertura PR → export PDF su MinIO
```

Procedura, dal caso più corto:

1. `/register` → `/credentials`: salva un PAT GitHub (basta sola lettura su repo pubblici).
   Deve comparire «Connessa e valida»: quel passo valida il token contro GitHub.
2. `/select`: repo pubblico piccolo, **una sola directory**
   (es. `OWASP/NodeGoat`, branch `master`, dir `app/routes`).
3. `/run`: lancia **`DOCS_INLINE`** (operazione più breve, timeout 90s).
4. `/tasks`: l'avanzamento deve muoversi **da solo**, senza ricaricare. Se resta fermo mentre
   il task avanza → problema nel WebSocket, non nell'agente.
5. `/reports`: apri il report, controlla che ci sia la proposta di modifica con il diff,
   prova l'export PDF.

Log utili se si rompe:

```bash
docker compose logs -f backend
docker compose logs -f agents
```

Poi, in ordine di complessità: `SECURITY_OWASP` (esercita Semgrep + triage LLM),
`SECURITY_POLICY` (con e senza `POLICY.md`), `CHANGELOG_TECHNICAL` (lettura Issue + sospensione
con richiesta input).

**I due punti più fragili della catena:**
- **callback HMAC di ritorno.** Verificato staticamente: `backend` firma
  `timestamp:method:request.path:bodyHash` (`internal-auth.guard.ts:40`) e gli agenti firmano
  `f"{api_prefix}{endpoint}"` (`github_toolset.py:59`). I prefissi **concordano** (`/api/v1`
  in `.env` e in `docker-compose.yml`). Sulla carta è a posto; va comunque visto girare.
- **WebSocket.** Nessun client reale l'ha mai aperto. Il passo 4 è il test.

### Passo 3 — Spec Playwright (riscritti, mai eseguiti)

Con Node 26 installato:

```bash
cd C:\Users\samue\Desktop\MVP
docker compose up -d
cd frontend
npx playwright install
npx playwright test --project=chromium --grep-invert @agent
```

`--grep-invert @agent` esclude i casi che avviano un agente vero (niente chiamate LLM): è il
giro per stanare i selettori sbagliati. Poi togli il filtro e aggiungi `--project=firefox`
e `--project=msedge`.

Su Windows resta nota l'anomalia `browserType.launch: spawn UNKNOWN` per Firefox
(non è un difetto del prodotto: riprova su un'altra macchina o su un runner CI).
Prerequisiti in `frontend/e2e/README.md`.

### Passo 4 — Test di integrazione backend (mai eseguiti)

```bash
cd C:\Users\samue\Desktop\MVP
pnpm test:integration
```

Alza `docker-compose.test.yml` (porte 27018 / 6380 / 9002), esegue, smonta.
**Si auto-saltano in silenzio** se Mongo/Redis di test non rispondono → «verde» può voler
dire «saltato»: controlla sempre il conteggio.
**Spegni lo stack di sviluppo prima**: un backend acceso sullo stesso Redis consuma i job
dei test e produce fallimenti fantasma.

### Passo 5 — Le verifiche già esistenti (baseline verde)

```bash
pnpm -r run test        # attesi: 356 backend, 10 frontend
pnpm --filter frontend typecheck:e2e
pnpm lint               # biome
pnpm -r run build
```

Python (venv 3.12):

```bash
cd agents
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
python -m pytest        # attesi: 35 (+1 smoke)
deactivate
```

---

## 3. Revisione del codice — cosa ho controllato

**Impressione generale:** codice curato, ben commentato sul _perché_ delle scelte,
separazione delle responsabilità chiara. Nessun problema strutturale trovato nella lettura.

Punti verificati staticamente:

- **Firma HMAC bidirezionale** (`internal-auth.guard.ts`, `github_toolset.py`): coerente,
  prefisso `/api/v1` allineato tra `.env` e `docker-compose.yml`. Timing-safe compare presente.
  Finestra anti-replay 30s.
- **Cifratura credenziali** (`credential-cipher.service.ts`): AES-256-GCM, HKDF con salt per
  record, master key mai riusata. Cifra una stringa arbitraria → adatta anche a un blob JSON.
- **`docker-compose.yml`**: rete `codeguardian-net` esplicita su tutti i servizi, override
  hostname corretti, healthcheck su tutti, `depends_on` con condizioni. Corretto.
- **Percorso SonarQube**: vedi §4 — non è un bug, è una feature incompleta **solo lato
  backend/frontend**; gli agenti sono già pronti.

Difetti aperti confermati (come da `DA-TESTARE` §4 — **non sono regressioni**):

| Cosa | Dove | Effetto |
|---|---|---|
| Sprint non selezionabile (RF.98) | `agents/src/agents/changelog.py:51,61` | Nessuno solleva l'interrupt `SPRINT_ID`: il changelog gira sempre su `"Current Sprint"`. Frontend/backend/modelli sono pronti. |
| `technicalReportId` sempre `null` | `agents/src/graph.py:669` | Scritto letteralmente `None` nell'interrupt `BUSINESS_CONFIRMATION`. |
| ~~SonarQube inerte~~ | backend + frontend | **Risolto** in questa sessione — vedi §4. |
| Nessun recupero task bloccati | `backend/src/tasks/task-processor.ts` | Un task `RUNNING` con claim scaduto non lo recupera nessuno. |
| `ruff format` | `agents/src/` | ~11/15 file verrebbero riformattati. Non blocca la CI (`ruff check`), ma rende rosso `npm run lint` in `agents/`. Da fare in un commit dedicato di sola formattazione. |

**Suite di test eseguite su questa macchina (Node 24, senza Docker):**

- `pnpm -r run test` (baseline, prima delle modifiche) → **backend 356/356**, **frontend 10/10**,
  `infra` nessun test. Coincide con gli attesi del documento.
- Dopo l'implementazione SonarQube (§4): **backend 373/373**, frontend 10/10, `pnpm lint` pulito,
  build backend + frontend + shared OK.
- Le righe `Error: pdfkit exploded` / `bucket unreachable` nel log sono **fixture volute**
  (test del percorso di errore dell'export PDF): le suite restano verdi.
- Python (35) non eseguito qui: richiede il venv 3.12 (vedi §1).
- `pnpm lint` / `pnpm build` non ri-eseguiti: il documento li dà verdi e non ho toccato codice.

---

## 4. SonarQube — RISOLTO in questa sessione

### 4.0 Cosa è stato fatto

Il provider `SONARQUBE` è ora un percorso completo: backend + frontend + wiring
agli agenti. File toccati:

| File | Modifica |
|---|---|
| `backend/src/credentials/supported-providers.ts` | Aggiunto `"SONARQUBE"` + costanti `GITHUB_PROVIDER` / `SONARQUBE_PROVIDER`. |
| `backend/src/credentials/dto/create-credential.dto.ts` | Campi `instanceUrl` / `projectKey` / `organizationKey`, obbligatori **solo** se `provider === "SONARQUBE"` (`@ValidateIf`). Il corpo GITHUB resta `{provider, token}`. |
| `backend/src/sonarqube/sonarqube-client.service.ts` (nuovo) | Verifica read-only: `GET /api/authentication/validate` per il token, `GET /api/components/show` per l'accesso al progetto. Token rifiutato / progetto invisibile → `AppException("CREDENTIAL_INVALID")`; guasti di rete / 5xx → propagati (→ UPSTREAM), mai scambiati per credenziale errata. |
| `backend/src/sonarqube/sonarqube.module.ts` (nuovo) | Modulo che espone il client. |
| `backend/src/credentials/credentials.service.ts` | `create` / `revalidate` fanno dispatch sul provider. Per SONARQUBE il bundle `{instanceUrl, projectKey, token, organizationKey?}` è cifrato come **un solo blob JSON** (stesso cipher, nessuna migrazione schema). Nuovo `getDecryptedSonarqubeCredential(userId)` → l'oggetto parsato, o `null` (è opzionale). |
| `backend/src/credentials/credentials.module.ts` | Importa `SonarqubeModule`. |
| `backend/src/tasks/agent-client.types.ts` | `payload.sonarqube_credentials?` nel corpo di `/internal/agent/start`. |
| `backend/src/tasks/agent-invocation.service.ts` | Per le operazioni `DOCS_*`, se l'utente ha una credenziale SONARQUBE, la decifra e la mette nel payload. Ogni errore qui è ingoiato: il task parte comunque. |
| `backend/src/common/openapi/api-schemas.ts` | `provider` documentato con l'enum completo. |
| `shared/src/types.ts` | `CreateCredentialDto` con i campi opzionali. |
| `frontend/src/pages/CredentialsPage.tsx` | Nuovo riquadro «SonarQube / SonarCloud» (URL istanza, chiave progetto, organizzazione opzionale, token). Non tocca i guard di rotta né lo store: una credenziale SonarQube mancante non blocca niente. |
| `.env.example`, `docker-compose.yml` | `ENABLE_SONARQUBE=true` di default (la funzionalità ora esiste davvero). |

**Test:** +17 test backend (`credentials.service.spec.ts`, nuovo
`sonarqube-client.service.spec.ts`, `agent-invocation.service.spec.ts`).
Tutte le suite verdi dopo le modifiche: **backend 373/373**, frontend 10/10,
`pnpm lint` pulito, build backend + frontend + shared OK.

Gli agenti erano **già pronti** (`agents/src/agents/docs.py` legge
`agent_payload["sonarqube_credentials"]`, `agents/src/sonarqube_service.py`
legge le metriche e le mette in cache): non è stato toccato nulla lato Python.

### 4.1 Come testarlo

1. Serve un'istanza **SonarQube** self-hosted o un progetto **SonarCloud**
   già analizzato, con un token utente che abbia il permesso «Browse» sul progetto.
2. Stack su con `ENABLE_SONARQUBE=true` (ora default nel `.env.example`).
3. `/credentials` → riquadro «SonarQube / SonarCloud»: inserisci URL istanza
   (es. `https://sonarcloud.io`), chiave progetto, organizzazione (solo SonarCloud), token.
   → deve comparire «Progetto collegato». Un token/chiave errati tornano 400 senza salvare.
4. Lancia un'operazione **`DOCS_INLINE`** o `DOCS_README` sullo stesso repo/progetto.
5. Nei log degli agenti (`docker compose logs -f agents`) deve comparire
   `Metriche SonarQube lette e messe in cache: progetto=... commit=...`; il prompt
   inviato all'LLM contiene la sezione `### Metriche SonarQube per i file in analisi`.
6. Prova anche il degrado: token valido ma istanza spenta → l'operazione DOCS
   deve completare comunque, senza metriche (warning `Metriche SonarQube non disponibili`).

### 4.2 Note di design

- Solo `token` è un vero segreto, ma si cifra l'intero bundle JSON per non
  aprire un secondo formato di record.
- SonarQube resta **opzionale ovunque**: `CredentialBanner` e i guard di
  `/select` / `/run` continuano a guardare solo GITHUB.
- La verifica del progetto (`components/show`) serve perché
  `authentication/validate` passa per qualsiasi token accettato, anche uno
  senza accesso a quel progetto.

<details><summary>Diagnosi originale (prima della correzione)</summary>

### Il problema, con precisione

Non sono "credenziali sbagliate": **il percorso per fornirle non esiste sul backend**.

Lo stato reale, componente per componente:

- **Agenti — già pronti.** `agents/src/sonarqube_service.py` (lettura metriche + cache Redis),
  le rotte `/internal/sonarqube/*` in `main.py`, e — soprattutto —
  `agents/src/agents/docs.py:67-98` che legge `agent_payload["sonarqube_credentials"]`
  (`{instanceUrl, projectKey, token, organizationKey?}`), chiama `get_metrics(...)` e inserisce
  le metriche nel prompt (`_with_sonarqube`). Con degrado silenzioso se qualcosa non va.
- **Config — spento.** `ENABLE_SONARQUBE=false` in `.env.example` e in `docker-compose.yml`.
  Con `false`, `main.py` non costruisce nemmeno il servizio (`sonar_service = None`).
- **Backend — manca tutto il pezzo a monte:**
  - `backend/src/credentials/supported-providers.ts` → `SUPPORTED_PROVIDERS = ["GITHUB"]`.
    Non si può nemmeno **salvare** una credenziale SonarQube.
  - `CreateCredentialDto` accetta solo `{provider, token}`; una credenziale Sonar ne ha 3-4 campi.
  - `CredentialsService.create()` chiama `verifyGithubToken()` in modo incondizionato: nessun
    dispatch per provider.
  - `agent-invocation.service.ts` costruisce il `payload` per `/internal/agent/start` **senza**
    la chiave `sonarqube_credentials`. Anche salvando le credenziali, non arriverebbero all'agente.
- **Frontend — GitHub-only.** `CredentialsPage.tsx` ha un solo campo (PAT GitHub).

Quindi: `grep -i sonarqube backend/src` non trova nulla — esattamente come annota il documento.

### Come risolverlo (piano, ~8-10 file, backend + frontend)

1. **`supported-providers.ts`** — aggiungi `"SONARQUBE"`.
2. **DTO** (`create-credential.dto.ts` + `@codeguardian/shared`) — campi opzionali
   `instanceUrl`, `projectKey`, `organizationKey`; validazione condizionata al provider
   (per `SONARQUBE` sono obbligatori `instanceUrl`+`projectKey`+`token`).
3. **Storage** — nessuna migrazione schema: per `SONARQUBE` si cifra
   `JSON.stringify({instanceUrl, projectKey, token, organizationKey})` come blob singolo
   (il cipher già lo permette). Per `GITHUB` resta la stringa nuda.
4. **Verifica per provider** — nuovo `SonarqubeClientService` che chiama
   `GET {instanceUrl}/api/authentication/validate` (auth: token come username) e controlla
   `{valid: true}`. `CredentialsService.create()`/`revalidate()` fanno dispatch su `dto.provider`.
5. **`getDecryptedCredential()`** — variante di `getDecryptedToken()` che per Sonar restituisce
   l'oggetto parsato.
6. **`agent-invocation.service.ts`** — quando l'operazione è `DOCS_*` e l'utente ha una
   credenziale `SONARQUBE`, decifra e aggiungi `payload.sonarqube_credentials = {...}`.
   Gli agenti la consumano già senza modifiche.
7. **Config** — `ENABLE_SONARQUBE=true` per il servizio `agents` in `docker-compose.yml`/`.env`.
8. **Frontend** — sezione SonarQube in `CredentialsPage.tsx` (URL istanza, project key, token,
   organizzazione opzionale per SonarCloud); `types.ts`; eventuale badge nello store.
9. **OpenAPI** (`common/openapi/api-schemas.ts`) + **test**: `credentials.service.spec.ts`,
   `agent-invocation.service.spec.ts`, spec frontend.

### Cosa serve per testarlo davvero

Un'istanza **SonarQube** raggiungibile (o un progetto **SonarCloud**) con un progetto già
analizzato e un token. Senza, si arriva solo fino alla validazione fallita.

### Alternativa minima

Se SonarQube è fuori dallo scope dell'MVP: lasciarlo `false` e **documentarlo come non
implementato** (una riga nel README + un test che verifica il degrado silenzioso). Zero rischio.

</details>

---

## 5. In una riga

Il prossimo passo non è scrivere codice: è **eseguire un'analisi completa** (`DOCS_INLINE`,
scope minimo, credenziali vere) con lo stack acceso — SonarQube incluso, ora che il
percorso c'è (§4.1).
