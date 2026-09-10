# feature/unione — come provarlo

Worktree: `C:\Users\Admin\Code_Guardian-unione`
Base: `feature/bedrock-qwen-config` + la suite di `feature/scrittura-test`.

Gia' fatto per te: `pnpm install`, build di `shared/`, venv degli agenti in
`Src/MVP/agents/.venv`, e `Src/MVP/.env` copiato da `.env.example`.

## 1. Le suite (non serve ne' Docker ne' AWS)

Backend — 503 passati, 55 rossi, 2 attesi rossi:

    cd Src\MVP\backend
    npx vitest run

Frontend — 181 passati, 56 rossi:

    cd Src\MVP\frontend
    npx vitest run

Agenti — 228 passati, 22 rossi, 4 xfail:

    cd Src\MVP\agents
    .venv\Scripts\python.exe -m pytest --ignore=tests/integration

Lint, entrambi verdi:

    cd Src\MVP\agents && .venv\Scripts\python.exe -m ruff check src/
    cd Src\MVP && pnpm exec biome check .

Nota su biome: segnala centinaia di errori `␍`, sono i CRLF che git mette in
checkout su Windows. Li ha anche bedrock (244) senza che nessuno abbia toccato
niente: su Linux, dove gira la CI, non esistono.

## 2. I test di integrazione (serve Docker Desktop avviato)

Mongo, Redis e MinIO, nessuna credenziale esterna:

    cd Src\MVP
    pnpm test:integration:up
    pnpm test:integration:test
    pnpm test:integration:down

## 3. Lo stack intero (serve Docker + le tue chiavi AWS)

Apri `Src\MVP\.env` e riempi tu queste due righe, io non le tocco:

    AWS_ACCESS_KEY_ID=
    AWS_SECRET_ACCESS_KEY=

Poi:

    cd Src\MVP
    docker compose up --build

Frontend su http://localhost:5173, backend su http://localhost:3000/api/v1.

## 4. Cosa e' ancora rosso, e perche'

Non sono residui del porting: sono punti in cui i due sorgenti dicono cose
diverse e serve decidere quale tenere.

Backend (55)
- `agent-invocation.service.spec.ts` (24) — qui il servizio legge il contesto
  dal DB e il costruttore ha un quarto argomento; i test costruiscono la
  vecchia forma.
- `credentials.service.spec.ts` (15) — questa base gestisce anche SONARQUBE.
- `report-artifact-storage` (4), `task-processor.claim-window` (3),
  `report-pdf.composer` (3), `agent-error-mapping` (2), e quattro singoli.
- `github-write.service.spec.ts` (2) — questi NON vanno riparati: sono i tuoi
  test che pretendono un file per PR, mentre qui la PR e' multi-file. Vanno
  sostituiti con gli spec di questa base.

Frontend (56) — quasi tutti testo dell'interfaccia: le due UI scrivono
etichette e messaggi diversi. `CredentialsPage` (13), `RunPage` (11),
`ReportDetailPage` (10), `renderers` (9), `SelectPage` (5), poi singoli.
Qui non decide il codice: decidete voi quale dicitura tenere.

Agenti (22) — `test_graph` (9) e `test_graph_nodes` (1): il grafo e' diverso.
`test_docs` (6): manca il pezzo lato agenti del template README (RF.79-81),
che ho portato solo lato backend. `test_github_toolset` (4), piu' due singoli.

## 5. Cosa e' stato portato

Da scrittura-test: 50 spec backend, 16 test frontend MVP, 11 test agenti,
la feature `backend/src/templates` (RF.79-81) con TemplatePage e la sua rotta,
il filtro d'ambito degli agenti (RF.30/RF.61), `requirements.txt` a `-e .[dev]`
e la `pr-check.yml` che gli step li esegue davvero.

Lasciato indietro di proposito: i test del frontend legacy (Setup,
TaskExecution, ReportView, RepositorySelection, Layout, useAppStore,
utils/api). Questa base ha tenuto solo l'interfaccia MVP.
