# End-to-end tests (Playwright)

These are the System Tests (TS_*) and Acceptance Tests (TA_*) from the
Test Plan. They run in the browser against the **real stack** -- frontend,
backend, MongoDB, Redis, MinIO and the agents service -- not against mocks,
and **they do not start anything on their own**: the stack must already be
running.

## Prerequisites

```bash
cd Src/MVP
docker compose up -d                    # full stack
```

The frontend served by Docker is at `http://localhost:5173`, which is the
configured `baseURL`. If you develop outside Docker instead, the frontend
must be started by telling it where the backend is, otherwise the Vite proxy
points to a hostname that exists only in the Docker network:

```bash
cd Src/MVP/backend  && pnpm run start:dev
cd Src/MVP/frontend && BACKEND_URL=http://localhost:3000 pnpm run dev -- --host
```

## Environment variables

Read from the `.env` at the root of `Src/MVP` (the same one used by
backend and agents).

| Variable | Used for | If missing |
|---|---|---|
| `E2E_GITHUB_PAT` | all specs that reach GitHub | tests skip themselves, they do not fail |
| `OPENAI_API_KEY` (or Bedrock credentials) | only specs marked `@agent` | the agent fails and the test with it |

A read-only PAT on public repositories is sufficient: no spec writes to
the test repositories. The only possible write is the Pull Request opened
by `DOCS_INLINE`, and the related case accepts a failed publication
notice as a valid outcome too.

## Execution

```bash
cd Src/MVP/frontend
npx playwright test                       # all browsers
npx playwright test --project=chromium    # Chromium only
npx playwright test --grep-invert @agent  # skip specs that start an agent
```

## The files

| Spec | Covers | Requires LLM |
|---|---|---|
| `auth-and-credentials.spec.ts` | RF.10, RF.11 -- registration, login, credential guard, PAT validation | no |
| `repository-errors.spec.ts` | RF.20, RF.21, RF.22, RF.29 -- errors in context creation | no |
| `reference-errors-and-scope.spec.ts` | RF.17, RF.24, RF.26, RF.27, RF.30 -- reference and scope | no |
| `docs-analysis.spec.ts` | RF.63, RF.72, RF.82, RF.83-85 -- diff proposal and PR opening | yes |
| `security-analysis.spec.ts` | TA_09, RF.53, RF.54, RF.60/61, RF.87-91 -- OWASP scan | yes |
| `security-policy-analysis.spec.ts` | RF.70, RF.92, RF.93 -- POLICY.md check, present and absent | yes |
| `changelog-analysis.spec.ts` | RF.94-98 -- technical changelog from Issues, with Sprint ID | yes |

`helpers.ts` is not a spec: it contains registration, PAT storage, context
creation and operation startup, i.e. the steps that every file would
otherwise repeat.

## Browsers

`playwright.config.ts` declares Chromium, Firefox and Edge -- this is what
makes RV.5 verifiable. Cases marked `@agent` run only on Chromium: they
start a real analysis, and repeating it on three engines would cost three
complete LLM calls to verify something that has nothing to do with the
browser.

On Windows, launching Firefox may fail with `browserType.launch: spawn
UNKNOWN`: this is a *side-by-side* configuration issue on the machine, not
a product issue. On `windows-latest` and `ubuntu-latest` in CI it starts
without problems.

## Why the specs were rewritten

The previous version drove the PoC interface: a `/setup` screen with
free-form `owner`/`repo` fields and a "Save and Start" button. The MVP
has none of those things -- there is a real account, a credentials page
that validates the token against GitHub, and a dropdown of repositories --
so those files all failed before they could verify anything.
