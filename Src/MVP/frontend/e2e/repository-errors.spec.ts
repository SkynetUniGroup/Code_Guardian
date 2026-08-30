import { test, expect } from '@playwright/test';

/**
 * Test di Sistema per i percorsi d'errore nella selezione del repository
 * (RF.20/UC11, RF.31/UC19). Entrambi falliscono prima di invocare
 * qualunque agente (l'errore avviene nella creazione del contesto), quindi
 * non serve una LLM_API_KEY reale — ma serve comunque un GitHub PAT reale
 * per raggiungere davvero le API di GitHub e ottenere l'errore genuino
 * (non simulato).
 */
const GITHUB_PAT = process.env.E2E_GITHUB_PAT;

test.describe('Percorsi d\'errore nella selezione del repository', () => {
  test.skip(!GITHUB_PAT, 'E2E_GITHUB_PAT non impostato nel .env — vedi TESTING.md');

  async function loginAndReachRepoForm(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.getByPlaceholder('ghp_xxxxxxxxxxxx...').fill(GITHUB_PAT!);
    await page.getByRole('button', { name: 'Salva e Inizia' }).click();
    await expect(page).toHaveURL('http://localhost:5173/');
  }

  test('RF.20 — repository inesistente: mostra un errore chiaro e non avvia la task', async ({ page }) => {
    await loginAndReachRepoForm(page);

    await page.getByPlaceholder('skynetunigroup').fill('questo-owner-non-esiste-e2e');
    await page.getByPlaceholder('code_guardian').fill('repo-fasullo-12345');
    await page.getByRole('button', { name: 'Carica operazioni disponibili' }).click();
    await page.getByRole('combobox').selectOption({ value: 'SECURITY_OWASP' });

    const dialogPromise = page.waitForEvent('dialog');
    await page.getByRole('button', { name: 'Avvia Analisi' }).click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain('Errore');
    await dialog.accept();

    // Nessuna navigazione: resta sulla pagina di selezione.
    await expect(page).toHaveURL('http://localhost:5173/');
  });

  test('RF.31 — ambito che supera il limite di 100 file: mostra l\'errore dimensionale', async ({ page }) => {
    await loginAndReachRepoForm(page);

    // OWASP/NodeGoat, intero repository (111 file al momento della
    // scrittura di questo test) — nessuno scope, cosi' scopeType diventa
    // FULL_REPOSITORY e supera il limite di RF.31.
    await page.getByPlaceholder('skynetunigroup').fill('OWASP');
    await page.getByPlaceholder('code_guardian').fill('NodeGoat');
    await page.getByPlaceholder('main').fill('master');
    await page.getByRole('button', { name: 'Carica operazioni disponibili' }).click();
    await page.getByRole('combobox').selectOption({ value: 'SECURITY_OWASP' });

    const dialogPromise = page.waitForEvent('dialog');
    await page.getByRole('button', { name: 'Avvia Analisi' }).click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toMatch(/limite di 100/);
    await dialog.accept();

    await expect(page).toHaveURL('http://localhost:5173/');
  });
});
