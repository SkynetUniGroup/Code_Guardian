import { test, expect } from '@playwright/test';

/**
 * TS_10 / TS_11 (PdQ) — RF.10, RF.11: configurazione iniziale del Personal
 * Access Token GitHub. Test di Sistema: gira nel browser contro lo stack
 * REALE (frontend + backend + MongoDB), non contro mock — vedi
 * playwright.config.ts e TESTING.md.
 *
 * Non serve un PAT/LLM_API_KEY reali: salvare la credenziale la cifra e
 * la scrive su MongoDB senza validarla contro le API di GitHub (endpoint
 * di validazione separato, opt-in — vedi backend/src/public/credentials.controller.ts).
 */
test.describe('Setup: configurazione iniziale', () => {
  test('un utente nuovo viene reindirizzato al Setup, salva il PAT e accede alla dashboard', async ({ page }) => {
    await page.goto('/');

    // Precondizione trasversale a quasi tutti gli altri TS: senza
    // configurazione il sistema reindirizza sempre su /setup (Layout.tsx).
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('heading', { name: 'Configurazione Iniziale' })).toBeVisible();

    // Il pulsante di submit è disabilitato finché il campo è vuoto (guardia lato UI).
    await expect(page.getByRole('button', { name: 'Salva e Inizia' })).toBeDisabled();

    await page.getByPlaceholder('ghp_xxxxxxxxxxxx...').fill('ghp_test_e2e_dummy_token_1234567890');
    await page.getByRole('button', { name: 'Salva e Inizia' }).click();

    // Salvataggio riuscito (chiamata reale POST /credentials) -> naviga alla
    // home e la Layout smette di reindirizzare a /setup.
    await expect(page).toHaveURL('http://localhost:5173/');
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  });
});
