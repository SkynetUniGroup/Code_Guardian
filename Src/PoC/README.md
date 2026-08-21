# Code Guardian — Agents Proof of Concept

Code Guardian is a system that automates code audits, maintenance and documentation
for software repositories, driven by LLM-based agents. This repository contains the
**Proof of Concept**: a vertical slice that takes one representative operation per agent
all the way from the UI to persistence, through a real GitHub repository.

Three agents are implemented, each with one representative operation:

| Agent | Operation code | What it does |
|---|---|---|
| **Docs** | `DOCS_INLINE` | Reads source files, finds undocumented functions/classes and proposes inline documentation as a diff |
| **Security** | `SECURITY_OWASP` | Scans the selected scope for OWASP Top 10 vulnerabilities and returns structured findings |
| **Security** | `SECURITY_POLICY` | Scans the selected scope against internal security rules defined in a `POLICY.md` file |
| **Changelog** | `CHANGELOG_TECHNICAL` | Reads closed GitHub Issues for a sprint and generates a dev-facing technical changelog |

This is an internal, didactic PoC — not a production system. It intentionally leaves out
a full orchestrator, authentication, AWS deployment, and Pull Request automation. See
[Project scope](#project-scope) below for details.

---

## Table of contents

- [Architecture at a glance](#architecture-at-a-glance)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick start (Docker Compose)](#quick-start-docker-compose)
- [First run walkthrough](#first-run-walkthrough)
- [Running the automated tests](#running-the-automated-tests)
- [Project scope](#project-scope)
- [Troubleshooting](#troubleshooting)

---

## Architecture at a glance

```
                  ┌────────────────────┐
   Browser  ───▶  │ frontend (React)   │  :5173
                  │ Vite + TanStack    │
                  └─────────┬──────────┘
                     REST + WebSocket
                            ▼
                  ┌────────────────────┐        ┌──────────┐
                  │ backend (NestJS)   │  :3000  │ MongoDB  │ :27017
                  │ REST API + WS      │◀───────▶│          │
                  │ GitHub facade      │        └──────────┘
                  │ (read-only)        │        ┌──────────┐
                  └─────────┬──────────┘◀──────▶│  Redis   │ (internal)
                     HTTP, HMAC-signed          │ (BullMQ) │
                            ▼                    └──────────┘
                  ┌────────────────────┐
                  │ agents (FastAPI +  │  (internal only, :8000)
                  │ LangGraph, Python) │
                  └─────────┬──────────┘
                            │
                  ┌─────────┴──────────┐
                  ▼                    ▼
            GitHub API           External LLM provider
        (via backend facade)     (OpenAI-compatible API)
```

Key points to keep in mind when working on this codebase:

- **The GitHub token never leaves the backend.** Agents never call GitHub directly; they
  call three read-only tools (`read_tree`, `read_file`, `read_issues`) that are exposed
  by the Python agent service and internally forward to HMAC-signed endpoints on the
  NestJS backend (`/internal/github/*`). This is by design (see ADR-1 in the PoC spec).
- **Routing is deterministic.** The mapping from an operation code to an agent is a
  static map (`AgentRegistry`) — no LLM is involved in dispatching a task.
- **Task execution is asynchronous.** `POST /tasks` enqueues a job (BullMQ/Redis) and
  returns immediately with `PENDING`; progress and completion are pushed to the frontend
  over a WebSocket, not polled.
- **The LLM is reached through a managed, OpenAI-compatible API** (e.g. Qwen via
  DashScope), never executed locally. An AWS Bedrock adapter exists in code but is
  intentionally not activatable in this PoC (no AWS credentials).

## Repository layout

```
.
├── agents/          Python service (FastAPI + LangGraph) — the 3 agents
│   ├── prompts/      External YAML prompt templates (one per agent/operation)
│   ├── src/           Agent graphs, GitHub tool client, LLM provider adapters
│   └── tests/          pytest suite
├── backend/         NestJS service — REST API, WebSocket, MongoDB, GitHub facade
│   ├── src/
│   └── test/          Jest end-to-end suite
├── frontend/        React app (Vite, TanStack Router, Zustand, Tailwind)
├── docker-compose.yml
├── package.json      Root workspace scripts (pnpm)
└── pnpm-workspace.yaml
```

`backend` and `frontend` are a pnpm workspace; `agents` is a standalone Python package
(not part of the pnpm workspace) built and run as its own container.

## Prerequisites

- **Docker** and **Docker Compose v2** (the `docker compose` CLI plugin) — this is all
  you need to run the whole stack.
- **Python 3.12**, only if you want to run the agents' pytest suite locally (see
  [Running the automated tests](#running-the-automated-tests)). Newer versions (tested
  with 3.14) also work fine.
- **Node.js 20+** (LTS recommended), only if you want to run the backend or frontend
  test suites directly on your machine instead of through Docker — see below. Not
  needed just to run the app via `docker compose up`.
- A **GitHub Personal Access Token** with **read-only** access (classic PAT with the
  minimal read scopes on `repo`, or a fine-grained PAT with read-only `Contents` and
  `Issues` permissions) — needed to actually run an agent against a real repository.
- An API key for an **OpenAI-compatible LLM endpoint** (the PoC defaults to Qwen via
  Alibaba Cloud DashScope) — needed to actually invoke an agent.

## Quick start (Docker Compose)

### 1. Configure environment variables

All services read their configuration from a single `.env` file at the repository root
(loaded by `docker-compose.yml` via `env_file: .env` and, for the backend, also directly
via `ConfigModule`). Copy the provided template and fill in the placeholders:

```bash
cp .env.example .env
```

> `INTERNAL_SHARED_SECRET` **must be identical** for `backend` and `agents` — it is the
> HMAC secret used to authenticate the internal, agent-to-backend calls.
> `MONGO_URI`, `REDIS_URL`, `JWT_SECRET`, `CREDENTIAL_MASTER_KEY` and
> `INTERNAL_SHARED_SECRET` are validated at backend startup (via Joi); the backend
> container will fail to boot if any of them is missing.
> The agents service will start without `LLM_API_KEY`, but any attempt to run an agent
> will fail immediately with a clear configuration error until it is set.
> Tip: generate strong random secrets with `openssl rand -hex 32`.

### 2. Build and start all services

```bash
docker compose up --build
```

This starts, in dependency order: `mongo`, `redis` → `backend` → `agents`, plus
`frontend`, `mailpit`, and `minio`. Wait for the backend health check to pass (it polls
`GET /api/v1/auth/health`) before the `agents` container starts.

To run everything in the background:

```bash
docker compose up --build -d
docker compose logs -f backend agents   # tail logs of the two app services
```

To stop everything:

```bash
docker compose down          # keep the mongo_data volume
docker compose down -v       # also wipe MongoDB data
```

### 3. Access the app

- Frontend: http://localhost:5173
- Backend API docs (Swagger): http://localhost:3000/api/docs

## First run walkthrough

1. Open http://localhost:5173. The app performs a stub login automatically on load
   (there is no real registration/login flow in this PoC — see [Project scope](#project-scope)).
2. You'll land on the **Setup** page: paste your read-only GitHub Personal Access Token
   and save it. It is encrypted (AES-256-GCM) before being stored.
3. On the next page, fill in `repoOwner` / `repoName` / `ref` (branch, tag or SHA) and,
   optionally, a scope (a sub-path) to limit the analysis. This creates an
   `AnalysisContext` pinned to a resolved commit SHA.
4. Load the available operations and pick one (`Documentazione Inline`,
   `Scansione OWASP`, or `Changelog Tecnico`), then start the analysis.
5. You'll be redirected to the task page, where progress updates arrive live over the
   WebSocket connection.
6. Once the task completes, open the generated **Report** — findings, the proposed diff,
   or the changelog Markdown, depending on the agent — and optionally export it as
   Markdown or JSON.

## Running the automated tests

> Looking for **what** each test suite actually verifies and what results to expect,
> rather than the commands to run them? See [`TESTING.md`](TESTING.md).

The commands below assume the stack is already up:

```bash
docker compose up -d
```

### Backend tests (Jest)

The **unit suite** mocks every external dependency (GitHub client, LLM/agent gateway,
MongoDB models) and needs no running service at all, so the simplest way to run it is
directly on your machine:

```bash
cd backend
npm install
npm run test         # unit tests
npm run test:cov     # unit tests with a coverage report
npm run test:watch   # watch mode
```

The **end-to-end suite** (`test/end-to-end.spec.ts`) is different: it boots the real
`AppModule` and genuinely needs a reachable MongoDB and Redis (GitHub and the agent
gateway are still mocked inside the test itself, so no real GitHub token or LLM key is
required). The easiest way to get those is to run it inside the `backend` container,
which is already wired to the `mongo`/`redis` services over the Docker network:

```bash
docker compose up -d mongo redis backend
docker compose exec backend pnpm run test:e2e
```

> If you'd rather run `test:e2e` on the host too, point `MONGO_URI` / `REDIS_URL` in
> your shell at `docker compose up -d mongo redis` published ports
> (`mongodb://localhost:27017/...`, `redis://localhost:6379`) instead of the in-network
> `mongo`/`redis` hostnames used inside `.env`.

### Agents tests (pytest) — run locally against the source tree

The `agents` Docker image only ships `src/` and `prompts/` (`tests/` is intentionally
not copied into the image, since it isn't needed to run the service) — so, unlike the
backend, the pytest suite has to run **locally**, against your checkout, rather than
with `docker compose exec agents ...`.

Almost the whole suite is self-contained: it uses an in-memory mock LLM provider and a
fake GitHub toolset, so it needs no network access, no running containers, and no
secrets. The only thing that actually differs between "running inside the container"
and "running locally" is where the YAML prompt templates live, since
`agents/src/config.py` defaults `PROMPTS_DIR` to the in-container path `/app/prompts`.
Rather than editing the shared `.env` file, just set `PROMPTS_DIR` for your current
shell session, pointing it at the local `prompts/` folder:

```bash
cd agents
python -m venv .venv          # optional but recommended
pip install -e ".[dev]"
```

Windows (PowerShell):

```powershell
$env:PROMPTS_DIR = ".\prompts"
python -m pytest
```

Linux / macOS (bash/zsh):

```bash
export PROMPTS_DIR=./prompts
python -m pytest
```

Run a single file the same way, e.g. `python -m pytest tests/test_security_parser.py`.

The exception is `test_golden_set_accuracy.py`: it is **skipped by default** and only
runs if `LLM_API_KEY` is also set, because it makes a real call to the configured LLM
provider to measure detection accuracy on a known-vulnerable code sample:

```powershell
$env:LLM_API_KEY = "your-llm-api-key-here"   # in addition to PROMPTS_DIR above
python -m pytest tests/test_golden_set_accuracy.py
```

### Frontend tests (Vitest)

Fully self-contained: every network call (`utils/api.ts`, WebSocket) is mocked, so no
backend, no Docker, and no secrets are needed.

```bash
cd frontend
npm install
npm test              # `vitest run` — single pass, CI-friendly
npm run test:watch    # interactive watch mode
npm run test:cov      # with a coverage report (text + HTML in coverage/)
```

## Project scope

This PoC deliberately covers **one vertical slice per agent**, not the full product.

**Included:**
- A shared LangGraph-based agent runtime (timeout handling, structured error states)
  with prompts isolated in external YAML files.
- Real, live, read-only integration with GitHub (code tree, file contents, issues)
  through a backend facade with a closed whitelist, HMAC-authenticated internal API,
  Redis caching, rate-limit awareness, and an access log.
- A shared `Report` output contract, persisted to MongoDB and served over REST.
- One operation per agent, end-to-end, driven from the React UI.
- A fully containerized local environment (Docker Compose) with local stand-ins for the
  AWS services referenced in the target architecture (Mailpit for SES, MinIO for S3).

**Not included (yet):**
- A full, deterministic orchestrator (batch handling, monitoring dashboard) — only the
  minimal routing needed to dispatch one operation to its agent.
- Any write access to GitHub: agents only ever produce a `Report`/diff **proposal**;
  applying it is a manual, human action. No Pull Request is ever opened automatically.
- Real AWS infrastructure (hosting, Bedrock, SES, S3) — everything above is a local
  substitute, wired so that migrating later is a configuration change, not a rewrite.
- Full authentication, registration, password recovery, multi-user support, and email
  notifications.
- The remaining operations of each agent (Docs README/API docs, Changelog business
  variant).

## Troubleshooting

- **Backend container restarts / crashes on boot** — check that `.env` defines
  `MONGO_URI`, `REDIS_URL`, `JWT_SECRET`, `CREDENTIAL_MASTER_KEY` and
  `INTERNAL_SHARED_SECRET`; these are validated at startup and the app refuses to boot
  without them.
- **Running an agent operation fails immediately with a configuration error** — the
  agents service needs `LLM_API_KEY` set (and `INTERNAL_SHARED_SECRET` matching the
  backend's value) to actually call the LLM provider.
- **`agents` container never becomes ready / stays behind `backend`** — this is
  expected: `docker-compose.yml` makes `agents` wait for the `backend` health check
  before starting.
- **Port already in use** — the Compose file publishes `5173` (frontend), `3000`
  (backend), `27017` (MongoDB), `8025` (Mailpit UI), `9000`/`9001` (MinIO); stop any
  local service already bound to those ports, or edit the `ports:` mappings.
- **"Endpoint non in whitelist" / 401 on internal calls** — the `agents` service is
  calling something outside the read-only whitelist, or the HMAC signature/timestamp is
  invalid (`INTERNAL_SHARED_SECRET` mismatch, or system clocks more than 60 seconds
  apart between containers).
- **`test:e2e` hangs or fails to connect** — make sure `docker compose up -d` has fully
  started `mongo` and `redis` first (check with `docker compose ps`), then run it via
  `docker compose exec backend pnpm run test:e2e`, not on the host.
- **`python -m pytest` fails with `FileNotFoundError` on a `.yaml` prompt file** — you're
  running it locally without setting `PROMPTS_DIR`; it defaults to the in-container path
  `/app/prompts`, which doesn't exist on your machine. Set it to the local `prompts/`
  folder for your shell session, as shown in the **"Agents tests (pytest)"** section
  above.