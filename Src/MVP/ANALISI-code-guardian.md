# Code Guardian — Analysis: What to Complete, How to Test, Code Status

_Analysis of the `MVP` folder against the `DA-TESTARE-code-guardian.md` document._
_Date: September 9, 2026._

---

## 0. First: This Folder Is Not a Git Checkout

`C:\Users\samue\Desktop\MVP` **is not a Git repository** (`.git` is missing) and **does not contain `.github/`**.
The `DA-TESTARE` document reasons in terms of branches and CI workflow
(`pr-check.yml`, `release.yml`): these are not present here. Practical consequences:

- You cannot verify "8 commits above `develop`", nor points §5.1 / §5.2 (merge with PR #396,
  pytest exiting with code 5 in CI): these concern CI, not the code you have at hand;
- Some minor discrepancies between documentation and code have already been resolved in this snapshot
  (e.g., `agents/tests/integration/` **already contains** `test_smoke.py`, so pytest no longer exits with 5);
- If you need to work on branches/PRs, request a real clone of the repository.

What you **can** do here is everything else: start the stack, run actual analyses,
run local test suites, and close open issues.

---

## 1. Environment Status on This Machine (Blockers to Resolve)

| Tool | Required | Present | Action |
|---|---|---|---|
| Node | `^26.8.1` (`package.json` → `devEngines`) | **v24.20.0** | Install Node 26. With Node 24, `npm`/`npx` in the folder exit immediately with `EBADDEVENGINES`. |
| pnpm | workspace pnpm | **missing** | `npm i -g pnpm@10` (run from a neutral folder, not from `MVP`). |
| Python | `>=3.12`, target `py312` | **3.14.7** | Agent dependencies (`semgrep`, `langgraph-checkpoint-mongodb<0.3`) are not guaranteed on 3.14. Use a **3.12** venv, or run agents only in Docker. |
| Docker | Compose v2 | **29.6.2 / Compose v5.3.1** | OK. |

`engine-strict=true` in `.pnpmrc`: if a package declares `engines.node`, `pnpm install`
stops. With Node 26, this problem disappears; alternatively, `pnpm install --config.engine-strict=false`.

**Recommendation:**
Install Node 26 and use a Python 3.12 venv. This is the path that unlocks both
local tests and Playwright specs. Docker covers runtime execution regardless.

---

## 2. What to Do to Complete and Test — In Order

### Step 1 — Start the Stack

```bash
cd C:\Users\samue\Desktop\MVP
cp .env.example .env
```

Generate the three secrets (Joi requires >=16 characters — see `backend/src/config/env.validation.ts`):

```bash
node -e "['JWT_SECRET','CREDENTIAL_MASTER_KEY','INTERNAL_SHARED_SECRET'].forEach(k=>console.log(k+'='+require('crypto').randomBytes(32).toString('hex')))"
```

Paste them into `.env`, then set a real `LLM_API_KEY` consistent with `LLM_PROVIDER`
(default is `managed` with DashScope/Qwen endpoint; for an OpenAI-compatible API, leave
`LLM_PROVIDER` as any value other than `bedrock` and set `LLM_BASE_URL`).

```bash
docker compose up -d --build
```

Verify: frontend at `http://localhost:5173`, API at `http://localhost:3000/api/v1`,
OpenAPI at `http://localhost:3000/api/docs`. Agents have no port on the host:

```bash
docker compose exec -T backend curl -s http://agents:8000/health
```

Note the two nearly identical names: `MONGODB_URI` (backend) vs `MONGO_URI` (agents). Same database.

### Step 2 — Run a Complete Analysis (This Is What Is Missing)

This chain has never been fully traversed:

```
POST /contexts → POST /tasks → BullMQ queue → TaskProcessor
  → HMAC call to agents → LangGraph → LLM
  → HMAC callback on /internal/tasks/:id/progress → WebSocket
  → Report assembly → PR opening → PDF export to MinIO
```

Procedure, starting with the shortest case:

1. `/register` → `/credentials`: save a GitHub PAT (read-only on public repos is sufficient).
   "Connected and valid" must appear: this step validates the token against GitHub.
2. `/select`: small public repo, **a single directory**
   (e.g., `OWASP/NodeGoat`, branch `master`, dir `app/routes`).
3. `/run`: launch **`DOCS_INLINE`** (shortest operation, 90s timeout).
4. `/tasks`: progress must move **on its own**, without reloading. If it stays still while
   the task advances → WebSocket problem, not agent problem.
5. `/reports`: open the report, verify the modification proposal with diff is present,
   try PDF export.

Useful logs if it breaks:

```bash
docker compose logs -f backend
docker compose logs -f agents
```

Then, in order of complexity: `SECURITY_OWASP` (exercises Semgrep + LLM triage),
`SECURITY_POLICY` (with and without `POLICY.md`), `CHANGELOG_TECHNICAL` (read Issue + suspension
with input request).

**The two most fragile points in the chain:**
- **Return HMAC callback.** Statically verified: `backend` signs
  `timestamp:method:request.path:bodyHash` (`internal-auth.guard.ts:40`) and agents sign
  `f"{api_prefix}{endpoint}"` (`github_toolset.py:59`). The prefixes **match** (`/api/v1`
  in `.env` and in `docker-compose.yml`). On paper it is correct; it still needs to be seen running.
- **WebSocket.** No real client has ever opened it. Step 4 is the test.

### Step 3 — Playwright Specs (Rewritten, Never Executed)

With Node 26 installed:

```bash
cd C:\Users\samue\Desktop\MVP
docker compose up -d
cd frontend
npx playwright install
npx playwright test --project=chromium --grep-invert @agent
```

`--grep-invert @agent` excludes cases that start a real agent (no LLM calls): this is
a way to catch wrong selectors. Then remove the filter and add `--project=firefox`
and `--project=msedge`.

On Windows, the anomaly `browserType.launch: spawn UNKNOWN` for Firefox remains
(it is not a product defect: retry on another machine or on a CI runner).
Prerequisites in `frontend/e2e/README.md`.

### Step 4 — Backend Integration Tests (Never Executed)

```bash
cd C:\Users\samue\Desktop\MVP
pnpm test:integration
```

Starts `docker-compose.test.yml` (ports 27018 / 6380 / 9002), runs, tears down.
**They auto-skip silently** if test Mongo/Redis do not respond → "green" can mean "skipped": always check the count.
**Turn off the development stack first**: a running backend on the same Redis consumes test jobs
and produces phantom failures.

### Step 5 — Existing Verifications (Green Baseline)

```bash
pnpm -r run test        # expected: 356 backend, 10 frontend
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
python -m pytest        # expected: 35 (+1 smoke)
deactivate
```

---

## 3. Code Review — What Was Checked

**General Impression:** Well-crafted code, well-commented on the _why_ of choices,
clear separation of responsibilities. No structural issues found during reading.

Points verified statically:

- **Bidirectional HMAC signing** (`internal-auth.guard.ts`, `github_toolset.py`): consistent,
  `/api/v1` prefix aligned between `.env` and `docker-compose.yml`. Timing-safe compare present.
  Anti-replay window: 30s.
- **Credential encryption** (`credential-cipher.service.ts`): AES-256-GCM, HKDF with salt per
  record, master key never reused. Encrypts an arbitrary string → suitable for a JSON blob too.
- **`docker-compose.yml`**: explicit `codeguardian-net` network on all services, correct hostname
  overrides, healthchecks on all, `depends_on` with conditions. Correct.
- **SonarQube path**: see §4 — not a bug, but an incomplete feature **only on the
  backend/frontend side**; agents are already ready.

Confirmed open defects (as per `DA-TESTARE` §4 — **not regressions**):

| What | Where | Effect |
|---|---|---|
| Sprint not selectable (RF.98) | `agents/src/agents/changelog.py:51,61` | No one raises the `SPRINT_ID` interrupt: changelog always runs on `"Current Sprint"`. Frontend/backend/models are ready. |
| `technicalReportId` always `null` | `agents/src/graph.py:669` | Literally written as `None` in the `BUSINESS_CONFIRMATION` interrupt. |
| ~~SonarQube inert~~ | backend + frontend | **Resolved** in this session — see §4. |
| No recovery of stuck tasks | `backend/src/tasks/task-processor.ts` | A `RUNNING` task with expired claim is not recovered by anyone. |
| `ruff format` | `agents/src/` | ~11/15 files would be reformatted. Does not block CI (`ruff check`), but makes `npm run lint` in `agents/` fail. To be done in a dedicated formatting-only commit. |

**Test suites executed on this machine (Node 24, without Docker):**

- `pnpm -r run test` (baseline, before changes) → **backend 356/356**, **frontend 10/10**,
  `infra` no tests. Matches the expected numbers in the document.
- After SonarQube implementation (§4): **backend 373/373**, frontend 10/10, `pnpm lint` clean,
  build backend + frontend + shared OK.
- Lines `Error: pdfkit exploded` / `bucket unreachable` in logs are **intentional fixtures**
  (error path test for PDF export): suites remain green.
- Python (35) not executed here: requires venv 3.12 (see §1).
- `pnpm lint` / `pnpm build` not re-executed: the document gives them as green and no code was touched.

---

## 4. SonarQube — RESOLVED in This Session

### 4.0 What Was Done

The `SONARQUBE` provider is now a complete path: backend + frontend + wiring
to agents. Files touched:

| File | Change |
|---|---|
| `backend/src/credentials/supported-providers.ts` | Added `"SONARQUBE"` + constants `GITHUB_PROVIDER` / `SONARQUBE_PROVIDER`. |
| `backend/src/credentials/dto/create-credential.dto.ts` | Fields `instanceUrl` / `projectKey` / `organizationKey`, required **only** if `provider === "SONARQUBE"` (`@ValidateIf`). The GITHUB body remains `{provider, token}`. |
| `backend/src/sonarqube/sonarqube-client.service.ts` (new) | Read-only check: `GET /api/authentication/validate` for the token, `GET /api/components/show` for project access. Rejected token / invisible project → `AppException("CREDENTIAL_INVALID")`; network failures / 5xx → propagated (→ UPSTREAM), never swapped for wrong credentials. |
| `backend/src/sonarqube/sonarqube.module.ts` (new) | Module exposing the client. |
| `backend/src/credentials/credentials.service.ts` | `create` / `revalidate` dispatch on provider. For SONARQUBE, the bundle `{instanceUrl, projectKey, token, organizationKey?}` is encrypted as **a single JSON blob** (same cipher, no schema migration). New `getDecryptedSonarqubeCredential(userId)` → parsed object, or `null` (it is optional). |
| `backend/src/credentials/credentials.module.ts` | Imports `SonarqubeModule`. |
| `backend/src/tasks/agent-client.types.ts` | `payload.sonarqube_credentials?` in the body of `/internal/agent/start`. |
| `backend/src/tasks/agent-invocation.service.ts` | For `DOCS_*` operations, if the user has a SONARQUBE credential, it decrypts and puts it in the payload. Any error here is swallowed: the task starts anyway. |
| `backend/src/common/openapi/api-schemas.ts` | `provider` documented with the full enum. |
| `shared/src/types.ts` | `CreateCredentialDto` with optional fields. |
| `frontend/src/pages/CredentialsPage.tsx` | New "SonarQube / SonarCloud" panel (instance URL, project key, optional organization, token). Does not touch route guards or store: a missing SonarQube credential does not block anything. |
| `.env.example`, `docker-compose.yml` | `ENABLE_SONARQUBE=true` by default (the feature now really exists). |

**Tests:** +17 backend tests (`credentials.service.spec.ts`, new
`sonarqube-client.service.spec.ts`, `agent-invocation.service.spec.ts`).
All suites green after changes: **backend 373/373**, frontend 10/10,
`pnpm lint` clean, build backend + frontend + shared OK.

Agents were **already ready** (`agents/src/agents/docs.py` reads
`agent_payload["sonarqube_credentials"]`, `agents/src/sonarqube_service.py`
reads metrics and caches them): nothing was touched on the Python side.

### 4.1 How to Test It

1. A **self-hosted SonarQube** instance or an already analyzed **SonarCloud**
   project is needed, with a user token that has "Browse" permission on the project.
2. Start the stack with `ENABLE_SONARQUBE=true` (now default in `.env.example`).
3. `/credentials` → "SonarQube / SonarCloud" panel: enter instance URL
   (e.g., `https://sonarcloud.io`), project key, organization (SonarCloud only), token.
   → must show "Connected project". An incorrect token/key returns 400 without saving.
4. Launch a **`DOCS_INLINE`** or `DOCS_README` operation on the same repo/project.
5. In agent logs (`docker compose logs -f agents`), `SonarQube metrics read and cached: project=... commit=...` must appear; the prompt
   sent to the LLM contains the `### SonarQube Metrics for files under analysis` section.
6. Also test degradation: valid token but instance down → the DOCS operation must complete anyway, without metrics (warning `SonarQube metrics unavailable`).

### 4.2 Design Notes

- Only `token` is a real secret, but the entire JSON bundle is encrypted to avoid
  introducing a second record format.
- SonarQube remains **optional everywhere**: `CredentialBanner` and route guards
  for `/select` / `/run` continue to check only GITHUB.
- Project verification (`components/show`) is needed because
  `authentication/validate` passes for any accepted token, even one
  without access to that project.

<details><summary>Original Diagnosis (Before Fix)</summary>

### The Problem, Precisely

It is not "wrong credentials": **the path to provide them does not exist on the backend**.

The real state, component by component:

- **Agents — already ready.** `agents/src/sonarqube_service.py` (read metrics + Redis cache),
  routes `/internal/sonarqube/*` in `main.py`, and — above all —
  `agents/src/agents/docs.py:67-98` which reads `agent_payload["sonarqube_credentials"]`
  (`{instanceUrl, projectKey, token, organizationKey?}`), calls `get_metrics(...)` and inserts
  metrics into the prompt (`_with_sonarqube`). With silent degradation if something goes wrong.
- **Config — off.** `ENABLE_SONARQUBE=false` in `.env.example` and in `docker-compose.yml`.
  With `false`, `main.py` does not even build the service (`sonar_service = None`).
- **Backend — everything upstream is missing:**
  - `backend/src/credentials/supported-providers.ts` → `SUPPORTED_PROVIDERS = ["GITHUB"]`.
    You cannot even **save** a SonarQube credential.
  - `CreateCredentialDto` only accepts `{provider, token}`; a SonarQube credential has 3-4 fields.
  - `CredentialsService.create()` calls `verifyGithubToken()` unconditionally: no
    dispatch by provider.
  - `agent-invocation.service.ts` builds the `payload` for `/internal/agent/start` **without**
    the `sonarqube_credentials` key. Even saving credentials, they would not reach the agent.
- **Frontend — GitHub-only.** `CredentialsPage.tsx` has only one field (GitHub PAT).

Therefore: `grep -i sonarqube backend/src` finds nothing — exactly as the document notes.

### How to Fix It (Plan, ~8-10 files, backend + frontend)

1. **`supported-providers.ts`** — add `"SONARQUBE"`.
2. **DTO** (`create-credential.dto.ts` + `@codeguardian/shared`) — optional fields
   `instanceUrl`, `projectKey`, `organizationKey`; validation conditional on provider
   (for `SONARQUBE`, `instanceUrl`+`projectKey`+`token` are required).
3. **Storage** — no schema migration: for `SONARQUBE`, encrypt
   `JSON.stringify({instanceUrl, projectKey, token, organizationKey})` as a single blob
   (the cipher already allows it). For `GITHUB`, it remains a plain string.
4. **Verification by provider** — new `SonarqubeClientService` that calls
   `GET {instanceUrl}/api/authentication/validate` (auth: token as username) and checks
   `{valid: true}`. `CredentialsService.create()`/`revalidate()` dispatch on `dto.provider`.
5. **`getDecryptedCredential()`** — variant of `getDecryptedToken()` that for SonarQube returns
   the parsed object.
6. **`agent-invocation.service.ts`** — when the operation is `DOCS_*`, and the user has a
   `SONARQUBE` credential, decrypt and add `payload.sonarqube_credentials = {...}`.
   Agents already consume it without changes.
7. **Config** — `ENABLE_SONARQUBE=true` for the `agents` service in `docker-compose.yml`/`.env`.
8. **Frontend** — SonarQube section in `CredentialsPage.tsx` (instance URL, project key, token,
   optional organization for SonarCloud); `types.ts`; optional badge in store.
9. **OpenAPI** (`common/openapi/api-schemas.ts`) + **tests**: `credentials.service.spec.ts`,
   `agent-invocation.service.spec.ts`, frontend specs.

### What Is Needed to Really Test It

A reachable **SonarQube** instance (or a **SonarCloud** project) with an already
analyzed project and a token. Without it, you only get to the failed validation.

### Minimal Alternative

If SonarQube is out of MVP scope: leave it `false` and **document it as not
implemented** (one line in README + a test that verifies silent degradation). Zero risk.

</details>

---

## 5. In One Line

The next step is not writing code: it is **running a complete analysis** (`DOCS_INLINE`,
minimal scope, real credentials) with the stack running — SonarQube included, now that the
path exists (§4.1).
