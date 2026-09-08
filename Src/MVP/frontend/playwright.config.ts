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
  // TNF_04 (RV.5) chiede di rieseguire la suite di accettazione sulle
  // versioni piu' recenti dei tre browser target e di accertare l'assenza di
  // anomalie su ciascuno. Non e' un caso di test a se': e' questa matrice.
  // Con un solo project dichiarato il requisito non era verificabile per
  // costruzione, qualunque test si fosse scritto.
  //
  // I tre non sono intercambiabili: Firefox ha un motore diverso (Gecko),
  // mentre Edge condivide Blink con Chromium ma e' un binario di sistema —
  // `channel: 'msedge'` usa l'Edge installato sulla macchina invece di
  // scaricarne una copia, che e' anche il modo in cui lo usa l'utente
  // finale. Firefox va scaricato una volta con
  // `npx playwright install firefox`; Edge dev'essere gia' presente nel
  // sistema. Se mancano, Playwright lo dice all'avvio del project e non a
  // meta' esecuzione.
  //
  // Per eseguirne uno solo: `npx playwright test --project=firefox`.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  ],
});
