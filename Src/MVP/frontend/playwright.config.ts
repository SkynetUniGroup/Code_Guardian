import { defineConfig, devices } from '@playwright/test';
import { loadEnvFile } from 'node:process';

// Carica il .env condiviso alla radice del monorepo (dove backend/agents lo
// leggono gia'): ci serve solo E2E_GITHUB_PAT, usato dai test che avviano
// un'analisi reale (vedi e2e/security-analysis.spec.ts). Se il file non
// esiste (es. CI) semplicemente non imposta nulla, i test che lo richiedono
// vengono skippati esplicitamente al loro interno.
try {
  loadEnvFile('../.env');
} catch {
  // .env non presente: i test che dipendono da E2E_GITHUB_PAT si auto-skippano.
}

/**
 * Config per i Test di Sistema (TS_*) e Test di Accettazione (TA_*) del PdQ:
 * girano nel browser contro lo stack REALE (frontend + backend + MongoDB +
 * Redis), non contro mock. A differenza dei test di unita' Vitest, questi
 * NON avviano un proprio server: presuppongono che lo stack sia gia' in
 * esecuzione (`docker compose up -d`) su http://localhost:5173 — vedi
 * TESTING.md per l'elenco dei test e cosa richiede ciascuno (alcuni
 * flussi, quelli che avviano un vero agente, richiedono anche un GitHub
 * PAT e una LLM_API_KEY reali in .env).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // i test condividono lo stesso utente/DB: eseguirli in serie evita interferenze
  // Un solo worker: questi test colpiscono GitHub/LLM/backend REALI e
  // condivisi. In parallelo si sono osservate interferenze reali (rate
  // limiting implicito, contesa sul backend) che facevano fallire login
  // legittimi — non un bug applicativo, ma un limite del setup di test.
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
