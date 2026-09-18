# Code Guardian

> Code Guardian è un MVP per l'analisi automatizzata di repository software tramite agenti LLM specializzati. Il sistema permette di selezionare un repository e un perimetro di analisi, eseguire operazioni di documentazione, sicurezza e changelog e visualizzare i report prodotti in tempo reale.
>
> L'architettura combina un frontend React/Vite, un backend NestJS, un servizio di agenti Python basato su FastAPI e LangGraph e un layer infrastrutturale AWS realizzato con CDK v2. In locale l'intero stack è orchestrato con Docker Compose; in AWS il runtime usa ECS Fargate, CloudFront, S3, ElastiCache Redis, MongoDB Atlas tramite PrivateLink e Amazon Bedrock.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Available Scripts](#available-scripts)
- [License](#license)

## Features

- **Repository context discovery**: risoluzione di repository GitHub, branch/commit e perimetro di analisi su intero repository, file o directory.
- **Documentazione assistita da LLM**:
  - `DOCS_README`: generazione/aggiornamento del README.
  - `DOCS_INLINE`: generazione o correzione di JSDoc/docstring.
  - `DOCS_API`: generazione della documentazione degli endpoint API.
- **Security analysis**:
  - `SECURITY_OWASP`: analisi rispetto a OWASP Top 10.
  - `SECURITY_POLICY`: verifica rispetto alle regole dichiarate in `POLICY.md`.
  - integrazione opzionale con **Semgrep** per SAST e **SonarQube/SonarCloud** per metriche di qualità.
- **Changelog generation**:
  - `CHANGELOG_TECHNICAL`: changelog tecnico delle issue/User Story chiuse in uno Sprint.
  - `CHANGELOG_BUSINESS`: changelog orientato al business a partire dal changelog tecnico, con fase di conferma umana prima della prosecuzione.
- **Agenti specializzati**: agenti Python separati per Docs, Security e Changelog, orchestrati tramite LangGraph.
- **LLM provider**: supporto a provider OpenAI-compatible e AWS Bedrock; nel deployment AWS gli agenti sono configurati per Qwen3.
- **Task orchestration**: task persistenti con stati `PENDING`, `RUNNING`, `COMPLETED`, `FAILED` e `CANCELLED`, coda BullMQ e Redis.
- **Realtime updates**: eventi di avanzamento task tramite Socket.IO/WebSocket.
- **Authentication & authorization**: registrazione/login con JWT e ruoli applicativi `DEVELOPER`, `SECURITY_AUDITOR` e `PROJECT_MANAGER`; le operazioni disponibili sono filtrate lato backend in base al ruolo.
- **GitHub integration**: lettura del tree/file/issue context e pubblicazione delle proposte tramite Pull Request quando previsto dall'operazione.
- **Report management**: report strutturati, visualizzazione, cancellazione ed esportazione PDF.
- **Object storage**: S3 in AWS e MinIO in locale per gli artefatti PDF.
- **API documentation**: OpenAPI/Swagger esposto dal backend sotto `/api/docs`.
- **Testing**: unit test con Vitest, test E2E del backend, test E2E del frontend con Playwright e test Python con pytest.
- **AWS infrastructure as code**: AWS CDK v2 in TypeScript con VPC, Security Group, VPC Endpoints, KMS/Secrets Manager/SSM, ECS Fargate, Cloud Map, ALB, CloudFront, ECR, Redis, osservabilità e budget.
- **CI/CD**: GitHub Actions con autenticazione AWS tramite OIDC, build/push delle immagini ECR, `cdk synth`, deploy ECS e build/publishing del frontend su S3 + invalidazione CloudFront.

## Architecture

### Local development

Lo stack locale usa `docker-compose.yml` e comprende:

```text
Browser
  |
  v
Frontend (Nginx :5173)
  | \
  |  \-- /socket.io/* --> Backend :3000
  \----- /api/* -------> Backend :3000
                             |
             +---------------+------------------+
             |               |                  |
             v               v                  v
          MongoDB          Redis             Agents :8000
          :27017          :6379                  |
                                                |
                                      +---------+---------+
                                      |                   |
                                      v                   v
                                  LLM provider        GitHub / SonarQube
```

Il frontend è servito da Nginx sulla porta `5173`. Le chiamate `/api/*` e `/socket.io/*` vengono inoltrate al backend, così il browser lavora in **same-origin**.

Il backend espone l'API sulla porta `3000`, usa MongoDB per la persistenza, Redis per BullMQ/cache/rate limiting e comunica con il servizio agenti sulla porta interna `8000`.

Il servizio Python usa FastAPI + LangGraph, persiste i checkpoint del grafo su MongoDB e usa Redis per i meccanismi operativi previsti dal codice. L'analisi di sicurezza può usare Semgrep; SonarQube è opzionale.

Per l'export dei report, in locale il backend usa MinIO come endpoint S3 compatibile.

### AWS deployment

L'infrastruttura CDK usa `eu-south-1` (Milano) come regione principale.

```text
                         +----------------------+
                         |       CloudFront     |
                         | HTTPS / SPA / OAC    |
                         +----------+-----------+
                                    |
                  +-----------------+-----------------+
                  |                                   |
                  v                                   v
          S3 Frontend Bucket                   ALB :80
                                                    |
                                                    v
                                             ECS Fargate
                                             +---------+
                                             | Backend |
                                             +----+----+
                                                  |
                       +--------------------------+----------------------+
                       |                          |                      |
                       v                          v                      v
              MongoDB Atlas                ElastiCache Redis       ECS Fargate
                PrivateLink                   (TLS)                 Agents
                                                                          |
                                                             +------------+-----------+
                                                             |                        |
                                                             v                        v
                                                          Bedrock                GitHub / SonarQube
```

Componenti principali definiti dagli stack sotto `infra/lib/`:

- **Network**: VPC `10.0.0.0/16`, 2 Availability Zone e 1 NAT Gateway.
- **Security Groups** e **VPC Endpoints** per limitare il traffico fra workload e servizi AWS.
- **KMS + Secrets Manager + Parameter Store** per i segreti e i parametri runtime.
- **S3** per gli artefatti dei report, con cifratura KMS e lifecycle di 30 giorni.
- **ElastiCache Redis 7.1**: `cache.t3.micro`, un solo nodo per l'MVP, cifratura at-rest e TLS in-transit.
- **MongoDB Atlas**: cluster gestito da Atlas; lato AWS viene predisposto il PrivateLink/Private Endpoint.
- **ECR**: repository per `backend` e `agents`.
- **ECS Fargate**:
  - backend: `512` CPU / `1024 MiB`, desired count `1`;
  - agents: `1024` CPU / `2048 MiB`, desired count `1`.
- **Cloud Map**: namespace interno `codeguardian.local` per la service discovery.
- **ALB**: espone il backend dietro CloudFront e supporta connessioni WebSocket con idle timeout esteso.
- **CloudFront**: serve il frontend da S3 privato e inoltra `/api/*` e `/socket.io/*` all'ALB.
- **Observability**: CloudWatch + SNS.
- **Budget**: `CodeGuardian-Budget`, deployato in `us-east-1`.

### Operazioni applicative

Le operazioni disponibili sono definite dal backend e associate a un agente e a uno o più ruoli:

| Codice | Area | Descrizione | Ruoli |
| --- | --- | --- | --- |
| `DOCS_README` | Docs | Generazione/aggiornamento README | Developer |
| `DOCS_INLINE` | Docs | JSDoc/docstring mancanti o non allineati | Developer |
| `DOCS_API` | Docs | Documentazione degli endpoint API | Developer |
| `SECURITY_OWASP` | Security | Analisi OWASP Top 10 | Security Auditor |
| `SECURITY_POLICY` | Security | Verifica delle regole di `POLICY.md` | Security Auditor |
| `CHANGELOG_TECHNICAL` | Changelog | Changelog tecnico da Sprint/issue | Project Manager, Developer |
| `CHANGELOG_BUSINESS` | Changelog | Changelog business da changelog tecnico | Project Manager |

Il backend espone inoltre API di autenticazione, repository/context, credentials, tasks, reports, operations e template README. Il prefisso globale delle API è `/api/v1`.

## Prerequisites

Per lo sviluppo completo del repository:

- **Node.js 26.8.1** o versione compatibile con il runtime dichiarato nel workspace.
- **pnpm** e supporto **Corepack**.
- **Python 3.12+** per il servizio `agents`.
- **Docker** e **Docker Compose** per eseguire lo stack locale completo.
- Un account **GitHub** e un Personal Access Token per le operazioni che richiedono accesso al repository.
- Un provider LLM configurato per l'esecuzione degli agenti. In locale il progetto supporta anche configurazioni OpenAI-compatible; nel deployment AWS viene usato Bedrock.
- Per le funzionalità SonarQube: un'istanza SonarQube/SonarCloud raggiungibile e, quando necessario, le relative credenziali.
- Per il deployment AWS: **AWS CLI**, accesso all'account target e **Node.js >= 20** per il progetto CDK sotto `infra/`.

> Lo sviluppo integrato è pensato per essere eseguito principalmente tramite Docker Compose. L'esecuzione dei singoli servizi senza Docker richiede comunque che MongoDB, Redis e il servizio agenti siano raggiungibili con le relative variabili di configurazione.

## Installation

### 1. Clone del repository

```bash
git clone <REPOSITORY_URL>
cd <PROJECT_DIRECTORY>
```

### 2. Installazione delle dipendenze Node

```bash
corepack enable
pnpm install --frozen-lockfile
```

Il repository è un workspace PNPM con i package `frontend`, `backend`, `infra` e `shared`.

### 3. Configurazione dell'ambiente locale

```bash
cp .env.example .env
```

Generare segreti locali dedicati e sostituire i placeholder presenti nel file `.env`.

Esempio:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Non utilizzare i valori presenti nei file `.env.example` come segreti reali e non committare `.env`.

### 4. Avvio con Docker Compose

```bash
docker compose up --build
```

Quando i container sono pronti:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000/api/v1`
- Swagger/OpenAPI: `http://localhost:3000/api/docs`
- Backend health check: `http://localhost:3000/api/v1/auth/health`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`

MongoDB e Redis non richiedono porte applicative aggiuntive per il normale utilizzo, ma sono esposti localmente rispettivamente sulle porte `27017` e `6379`.

### 5. Installazione del servizio Python in ambiente standalone

Quando si vuole eseguire `agents` fuori da Docker:

```bash
cd agents
python -m venv .venv

# Linux/macOS
source .venv/bin/activate

# Windows PowerShell
# .\.venv\Scripts\Activate.ps1

pip install -e ".[dev]"
```

Poi configurare le variabili dell'ambiente necessarie e avviare FastAPI:

```bash
uvicorn src.main:app --host 0.0.0.0 --port 8000
```

## Configuration

### Variabili principali

Il file `.env.example` alla radice è il riferimento principale per l'esecuzione con Docker Compose. Esiste anche `backend/.env.example` per l'esecuzione standalone del backend.

| Variabile | Scopo |
| --- | --- |
| `NODE_ENV` | Modalità applicativa (`development`, `test`, `production`). |
| `PORT` | Porta HTTP del backend; default `3000`. |
| `CORS_ORIGIN` | Origine frontend autorizzata dal backend. |
| `JWT_SECRET` | Segreto per i token JWT. |
| `CREDENTIAL_MASTER_KEY` | Chiave master usata per proteggere le credenziali salvate. |
| `INTERNAL_SHARED_SECRET` | Segreto condiviso per le chiamate interne firmate HMAC. |
| `HMAC_WINDOW_S` | Finestra temporale anti-replay delle richieste interne. |
| `MONTHLY_TASK_LIMIT` | Numero massimo di task avviabili per utente nel mese. |
| `MONGODB_URI` | URI MongoDB usato dal backend. |
| `MONGO_URI` | URI MongoDB usato dagli agenti/langgraph checkpointing. |
| `REDIS_URL` | Connessione Redis/BullMQ. |
| `AGENTS_SERVICE_URL` | URL del servizio Python agenti. |
| `BACKEND_BASE_URL` | Base URL del backend visto dagli agenti. |
| `BACKEND_API_PREFIX` | Prefisso API usato anche nella firma HMAC; nel progetto è `/api/v1`. |
| `LLM_PROVIDER` | Provider LLM; nel deployment AWS è `bedrock`. |
| `LLM_MODEL_GENERAL` | Modello per Docs/Changelog. |
| `LLM_MODEL_SECURITY` | Modello per Security. |
| `AWS_REGION` | Regione AWS usata dal provider Bedrock. |
| `ENABLE_SAST_SEMGREP` | Abilita/disabilita la fase SAST Semgrep. |
| `SEMGREP_TIMEOUT_S` | Timeout della scansione Semgrep. |
| `SAST_MAX_FINDINGS_LLM` | Massimo numero di finding passati alla valutazione LLM. |
| `SAST_MAX_FILES` | Massimo numero di file considerati dal SAST. |
| `ENABLE_SONARQUBE` | Abilita/disabilita l'arricchimento con metriche SonarQube. |
| `SONAR_CACHE_TTL_S` | TTL della cache delle metriche SonarQube. |
| `REPORTS_BUCKET_NAME` | Bucket S3/MinIO per gli artefatti PDF. |
| `S3_REGION` | Regione del bucket S3. |
| `S3_ENDPOINT` | Endpoint custom S3; in locale punta a MinIO, in AWS va lasciato non impostato. |
| `S3_FORCE_PATH_STYLE` | Necessario per MinIO; in AWS non serve. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Credenziali MinIO in locale. In AWS non sono necessarie: il backend usa il Task Role ECS. |

### GitHub e SonarQube

Le credenziali applicative vengono gestite dal backend tramite il modulo `credentials`. Per GitHub il backend gestisce token personali; per SonarQube/SonarCloud sono previsti anche `instanceUrl`, `projectKey` e, quando richiesto, `organizationKey`.

Le operazioni che accedono a GitHub fanno riferimento al context di repository creato dal backend. Il servizio agenti non contiene nel proprio stato il segreto HMAC: il toolset viene ricostruito in fase di esecuzione.

### AWS configuration

Prima del deploy AWS, aggiornare i valori di contesto in `infra/cdk.json` o passarli con `--context`:

- `atlasPrivateEndpointServiceName`
- `alertEmail`
- `githubOrg`
- `githubRepo`
- `monthlyBudgetUsd`

Non inserire nel repository segreti applicativi o token AWS statici. In produzione:

- i segreti del backend arrivano da **AWS Secrets Manager**;
- Redis e altri parametri arrivano da **SSM Parameter Store**;
- gli agenti invocano Bedrock tramite **ECS Task Role**;
- la pipeline GitHub Actions utilizza **OIDC** per assumere il ruolo AWS.

### Bedrock

L'infrastruttura AWS è configurata per usare Qwen3 in `eu-south-1`. Il `RUNBOOK` richiede di verificare preventivamente l'accesso ai modelli e, se necessario, l'uso di Inference Profile ARN.

Prima del primo deploy operativo è quindi necessario completare la richiesta di accesso ai modelli in Bedrock.

## Usage

### Avvio in sviluppo

Lo scenario consigliato è:

```bash
cp .env.example .env
corepack enable
pnpm install --frozen-lockfile
docker compose up --build
```

Per fermare i container:

```bash
docker compose down
```

Per rimuovere anche i volumi locali di MongoDB e MinIO:

```bash
docker compose down -v
```

### Sviluppo frontend

Il frontend usa Vite in sviluppo:

```bash
pnpm --filter frontend dev
```

Il dev server è configurato sulla porta `5173` e inoltra:

- `/api/*` al backend;
- `/socket.io/*` al backend con supporto WebSocket.

### Sviluppo backend

```bash
pnpm --filter backend start:dev
```

Il backend espone:

```text
/api/v1
```

e la documentazione OpenAPI su:

```text
/api/docs
```

### Esecuzione degli agenti

```bash
cd agents
uvicorn src.main:app --host 0.0.0.0 --port 8000
```

L'endpoint di health check è:

```text
GET /health
```

Gli endpoint `/internal/*` degli agenti sono pensati per essere raggiunti dal backend e non vengono pubblicati sull'host dal Docker Compose principale.

### Test

Unit test e test dei package Node:

```bash
pnpm test:unit
```

Test di integrazione backend:

```bash
pnpm test:integration
```

Suite completa del monorepo:

```bash
pnpm test
```

Coverage:

```bash
pnpm test:cov
```

Test Python:

```bash
cd agents
pytest
```

Lint/format Python:

```bash
cd agents
make lint
```

### AWS deployment

La procedura completa e le attività manuali sono documentate in:

- [`infra/README.md`](infra/README.md)
- [`infra/RUNBOOK.md`](infra/RUNBOOK.md)

#### 1. Prerequisiti manuali

Prima del deploy completo:

1. Richiedere accesso ai modelli Bedrock richiesti.
2. Completare il collegamento MongoDB Atlas PrivateLink.
3. Configurare i secrets GitHub Actions.
4. Confermare la subscription email SNS.
5. Predisporre le immagini ECR iniziali quando si vuole validare manualmente il flusso.
6. Effettuare il bootstrap `us-east-1` per lo stack AWS Budgets.
7. Attivare il tag `Project` come Cost Allocation Tag.
8. Impostare il budget mensile concordato.

Dettagli e comandi sono in [`infra/RUNBOOK.md`](infra/RUNBOOK.md).

#### 2. Bootstrap CDK

Dalla cartella `infra`:

```bash
npm install

aws login

npx cdk bootstrap aws://<ACCOUNT_ID>/eu-south-1
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
```

`us-east-1` è necessario per `CodeGuardian-Budget`.

#### 3. Verifica e deploy

```bash
npm run synth
npm run deploy:all
```

Il deploy incrementale, utile per isolare eventuali errori, segue quest'ordine:

```bash
npm run deploy:network
npm run deploy:cicd-identity
npm run deploy:secrets
npm run deploy:storage
npm run deploy:security-groups
npm run deploy:vpc-endpoints
npm run deploy:data
npm run deploy:atlas
npm run deploy:compute
npm run deploy:cloudfront
npm run deploy:observability
npm run deploy:budget
```

Lo stack `CodeGuardian-Atlas` richiede il valore reale di:

```bash
--context atlasPrivateEndpointServiceName=<SERVICE_NAME>
```

#### 4. Primo deploy operativo

Dopo il primo deploy completo:

- confermare l'email SNS;
- verificare il collegamento Atlas e aggiornare il secret `codeguardian/mongo-uri` con la connection string del Private Endpoint;
- verificare il servizio backend e gli health check ECS;
- fare il primo push delle immagini ECR se non è stato eseguito tramite pipeline.

Esempio di push manuale:

```bash
aws ecr get-login-password --region eu-south-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.eu-south-1.amazonaws.com

docker build -t <ACCOUNT_ID>.dkr.ecr.eu-south-1.amazonaws.com/codeguardian/backend:latest backend/
docker push <ACCOUNT_ID>.dkr.ecr.eu-south-1.amazonaws.com/codeguardian/backend:latest

docker build -t <ACCOUNT_ID>.dkr.ecr.eu-south-1.amazonaws.com/codeguardian/agents:latest agents/
docker push <ACCOUNT_ID>.dkr.ecr.eu-south-1.amazonaws.com/codeguardian/agents:latest
```

#### 5. Debug dei container ECS

Backend e agenti hanno ECS Exec abilitato:

```bash
aws ecs execute-command \
  --cluster codeguardian-cluster \
  --task <TASK_ID> \
  --container backend \
  --interactive \
  --command "/bin/sh"
```

### CI/CD

Il workflow [`infra/.github/workflows/deploy.yml`](infra/.github/workflows/deploy.yml) distingue due percorsi.

**Pull Request**

- typecheck dell'infrastruttura CDK;
- build locale delle immagini Docker;
- nessuna credenziale AWS necessaria.

**Push su `main`**

1. build delle immagini backend e agents;
2. push in ECR;
3. `cdk synth`;
4. deploy dello stack `CodeGuardian-Compute`;
5. build del frontend con `VITE_API_BASE_URL=/api/v1`;
6. sync del `dist/` sul bucket frontend S3;
7. invalidazione della distribuzione CloudFront.

I secrets richiesti dal workflow sono:

| Secret | Utilizzo |
| --- | --- |
| `AWS_ACCOUNT_ID` | ARN del ruolo OIDC assunto dalla pipeline. |
| `FRONTEND_BUCKET_NAME` | Bucket S3 del frontend. |
| `CLOUDFRONT_DISTRIBUTION_ID` | Invalidazione cache dopo il deploy frontend. |

## Project Structure

```text
MVP/
├── agents/                         # Servizio Python FastAPI + LangGraph
│   ├── src/
│   │   ├── agents/                 # Profili Docs, Security e Changelog
│   │   ├── graph.py                # Grafo/orchestrazione LangGraph
│   │   ├── github_toolset.py       # Tool GitHub usati dagli agenti
│   │   ├── llm.py                  # Provider LLM
│   │   ├── models.py               # Modelli API/stato agenti
│   │   ├── sast_analyzer.py        # SAST Semgrep
│   │   └── sonarqube_service.py    # Integrazione metriche SonarQube
│   ├── prompts/                    # Prompt versionati per operazione
│   ├── tests/                      # Unit/integration test Python
│   ├── Dockerfile
│   ├── Makefile
│   └── pyproject.toml
│
├── backend/                        # API NestJS e orchestrazione task
│   ├── src/
│   │   ├── auth/                   # Registrazione, login, JWT
│   │   ├── credentials/            # Credenziali GitHub/SonarQube
│   │   ├── contexts/               # Repository/context analysis
│   │   ├── events/                 # WebSocket + progress events
│   │   ├── github/                 # Client e write operations GitHub
│   │   ├── operations/             # Registry operazioni e RBAC
│   │   ├── reports/                # Report e PDF export
│   │   ├── tasks/                  # Coda, processing e agent invocation
│   │   └── templates/              # Template README personalizzabile
│   ├── test/                       # E2E test
│   ├── Dockerfile
│   └── package.json
│
├── frontend/                       # React + Vite + TanStack Router
│   ├── src/
│   │   ├── api/                    # Client HTTP e gestione errori
│   │   ├── components/             # Componenti condivisi
│   │   ├── hooks/                  # Hook realtime
│   │   ├── pages/                  # Schermate principali
│   │   ├── routes/                 # Albero route applicativo
│   │   ├── stores/                 # Stato Zustand
│   │   └── types/                  # Tipi frontend
│   ├── e2e/                        # Playwright
│   ├── Dockerfile
│   └── nginx.conf
│
├── infra/                          # AWS CDK v2
│   ├── bin/codeguardian.ts         # Wiring e dipendenze tra gli stack
│   ├── lib/
│   │   ├── atlas-stack.ts
│   │   ├── budget-stack.ts
│   │   ├── cicd-identity-stack.ts
│   │   ├── cloudfront-stack.ts
│   │   ├── compute-stack.ts
│   │   ├── data-stack.ts
│   │   ├── kms-secrets-stack.ts
│   │   ├── network-stack.ts
│   │   ├── observability-stack.ts
│   │   ├── security-groups-stack.ts
│   │   ├── storage-stack.ts
│   │   └── vpc-endpoints-stack.ts
│   ├── .github/workflows/deploy.yml
│   ├── cdk.json
│   ├── package.json
│   └── RUNBOOK.md
│
├── shared/                         # Tipi TypeScript condivisi
│   ├── src/types.ts
│   └── package.json
│
├── scripts/                        # Script di supporto al repository
├── docker-compose.yml              # Stack locale
├── docker-compose.test.yml         # Dipendenze per integration test
├── .env.example                    # Configurazione locale
├── package.json                    # Script del workspace
├── pnpm-workspace.yaml             # Workspace PNPM
└── pnpm-lock.yaml                  # Lockfile
```

## Available Scripts

### Root workspace

| Script | Descrizione |
| --- | --- |
| `pnpm lint` | Esegue il check Biome sul repository. |
| `pnpm format` | Applica la formattazione Biome. |
| `pnpm lint:fix` | Formatta e riesegue il lint. |
| `pnpm build` | Esegue il `build` di tutti i workspace PNPM che lo dichiarano. |
| `pnpm test:unit` | Esegue i test dei workspace Node. |
| `pnpm test:integration:up` | Avvia i servizi MongoDB/Redis/MinIO dedicati ai test di integrazione. |
| `pnpm test:integration:test` | Esegue la suite E2E del backend. |
| `pnpm test:integration:down` | Ferma e rimuove i servizi dei test di integrazione. |
| `pnpm test:integration` | Esegue end-to-end setup, test e teardown dell'infrastruttura di test. |
| `pnpm test` | Esegue unit test e test di integrazione. |
| `pnpm test:cov` | Esegue i test con coverage nei workspace che supportano lo script. |

### Backend

Dalla root:

```bash
pnpm --filter backend start
pnpm --filter backend start:dev
pnpm --filter backend start:debug
pnpm --filter backend start:prod
pnpm --filter backend test
pnpm --filter backend test:cov
pnpm --filter backend test:e2e
```

### Frontend

```bash
pnpm --filter frontend dev
pnpm --filter frontend build
pnpm --filter frontend preview
pnpm --filter frontend test
pnpm --filter frontend test:cov
pnpm --filter frontend test:e2e
pnpm --filter frontend test:e2e:ui
```

### Infrastructure CDK

Dalla directory `infra/`:

```bash
npm run build
npm run synth
npm run diff
npm run deploy:all
```

Sono inoltre disponibili i deploy per singolo stack:

```text
deploy:network
deploy:cicd-identity
deploy:secrets
deploy:storage
deploy:security-groups
deploy:vpc-endpoints
deploy:data
deploy:atlas
deploy:compute
deploy:cloudfront
deploy:observability
deploy:budget
```

### Agents

Dalla directory `agents/`:

```bash
make lint
make format-check
make ruff-check
make format
make ruff-fix
make fix
make clean
make install-dev
pytest
```

> `agents/Makefile` non definisce un target `test` operativo: la suite Python viene eseguita direttamente con `pytest`.

## License

Nessun file di licenza è presente nel repository e i package non dichiarano una licenza di progetto condivisa. Inserire qui la licenza scelta dal team prima di pubblicare il progetto.
