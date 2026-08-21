import { test, expect } from '@playwright/test';

/**
 * TS/TA per l'Agente Changelog, operazione CHANGELOG_TECHNICAL (RF.94-97).
 * End-to-end reale sul repository pubblico del gruppo stesso
 * (SkynetUniGroup/Code_Guardian), che ha issue chiuse reali da tutti gli
 * sprint del Piano di Progetto — a differenza di Security/Docs qui non
 * serve un ambito di file, l'agente legge le Issue di GitHub.
 *
 * NOTA: questo test documenta due comportamenti anomali scoperti scrivendolo
 * (vedi TESTING.md, sezione bug):
 * 1. Il backend supporta un campo opzionale `sprintId` nel contesto
 *    (RF.98), ma il frontend di questo PoC non espone alcun campo per
 *    inserirlo — quindi da UI l'operazione gira sempre col default.
 * 2. La creazione del contesto valida SEMPRE il numero di file e il
 *    linguaggio dell'ambito (RF.31, RF.24) anche per Changelog, che non
 *    legge codice sorgente ma solo Issue — quindi l'intero repository
 *    Code_Guardian (293 file) supera il limite anche per questa
 *    operazione. Usiamo uno scope minimo (Website/, 7 file) solo per
 *    superare questa validazione e arrivare a testare l'agente vero e
 *    proprio.
 */
const GITHUB_PAT = process.env.E2E_GITHUB_PAT;

test.describe('Flusso completo: Agente Changelog — changelog tecnico da Issue reali', () => {
  test.skip(!GITHUB_PAT, 'E2E_GITHUB_PAT non impostato nel .env — vedi TESTING.md');
  test.setTimeout(6 * 60_000);

  test('avvia CHANGELOG_TECHNICAL: completa ma senza poter scegliere lo Sprint da UI (RF.98 non implementato)', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('ghp_xxxxxxxxxxxx...').fill(GITHUB_PAT!);
    await page.getByRole('button', { name: 'Salva e Inizia' }).click();
    await expect(page).toHaveURL('http://localhost:5173/');

    await page.getByPlaceholder('skynetunigroup').fill('SkynetUniGroup');
    await page.getByPlaceholder('code_guardian').fill('Code_Guardian');
    // Nessun campo Sprint ID nel form: confermato assente cercando "sprint"
    // in tutto frontend/src prima di scrivere questo test.
    await expect(page.getByText(/sprint/i)).toHaveCount(0);
    // Scope minimo solo per superare la validazione RF.31 (100 file) che si
    // applica anche a Changelog nonostante non legga codice — vedi nota sopra.
    await page.getByPlaceholder('es. Src/').fill('Website');

    await page.getByRole('button', { name: 'Carica operazioni disponibili' }).click();
    await page.getByRole('combobox').selectOption({ value: 'CHANGELOG_TECHNICAL' });
    await page.getByRole('button', { name: 'Avvia Analisi' }).click();

    await expect(page).toHaveURL(/\/tasks\/.+/, { timeout: 20_000 });
    await expect(page.getByText('Analisi completata!')).toBeVisible({ timeout: 5 * 60_000 });
    await expect(page.getByText('Analisi fallita')).not.toBeVisible();

    await page.getByRole('link', { name: 'Visualizza Report →' }).click();
    await expect(page.getByRole('heading', { name: 'Analisi: CHANGELOG_TECHNICAL' })).toBeVisible();
    await expect(page.getByText('Dettagli')).toBeVisible();
  });
});
