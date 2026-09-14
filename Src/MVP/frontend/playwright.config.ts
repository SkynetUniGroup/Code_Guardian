import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";

// Loads the shared .env at the monorepo root (where backend/agents already
// read it): we only need E2E_GITHUB_PAT, used by tests that start a real
// analysis (see e2e/security-analysis.spec.ts). If the file does not exist
// (e.g. CI) it simply sets nothing, the tests that require it are explicitly
// skipped inside them.
try {
  loadEnvFile("../.env");
} catch {
  // .env not present: tests that depend on E2E_GITHUB_PAT auto-skip.
}

/**
 * Config for the System Tests (TS_*) and Acceptance Tests (TA_*) of the PdQ:
 * they run in the browser against the REAL stack (frontend + backend + MongoDB
 * + Redis), not against mocks. Unlike the Vitest unit tests, these do NOT
 * start their own server: they assume the stack is already running
 * (`docker compose up -d`) on http://localhost:5173 â see e2e/README.md for
 * the list of tests and what each requires (some flows, those that start a
 * real agent, also require a real GitHub PAT and LLM_API_KEY in .env).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // tests share the same user/DB: running them in series avoids interference
  // A single worker: these tests hit REAL and shared GitHub/LLM/backend. In
  // parallel, real interference was observed (implicit rate limiting,
  // backend contention) that caused legitimate logins to fail â not an
  // application bug, but a limitation of the test setup.
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // RV.5 â cross-browser compatibility. With only one project declared the
  // requirement was unverifiable by construction: the suite ran three times
  // on the same engine.
  //
  // Cases marked @agent run only on Chromium. This is not a shortcut:
  // they start a real agent, with real calls to GitHub and the LLM, and
  // repeating them on three browsers costs three complete analyses to
  // verify something that has nothing to do with the browser. What RV.5
  // asks â that the interface behaves the same way elsewhere â is verified
  // by the other cases, which are also the ones that touch modals, forms,
  // redirects and WebSocket.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, grepInvert: /@agent/ },
    {
      name: "edge",
      use: { ...devices["Desktop Edge"], channel: "msedge" },
      grepInvert: /@agent/,
    },
  ],
});
