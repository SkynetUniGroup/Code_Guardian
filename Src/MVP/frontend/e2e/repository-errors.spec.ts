import { expect, test } from "@playwright/test";
import { GITHUB_PAT, SKIP_REASON, signedInWithCredentials, submitContext } from "./helpers";

/**
 * Test di Sistema sui percorsi d'errore nella creazione del contesto
 * (RF.20/UC11, RF.31/UC19). Falliscono tutti prima che venga invocato un
 * agente — l'errore nasce nella creazione del contesto — quindi non serve una
 * chiave LLM; serve pero' un PAT reale, perche' l'errore deve arrivare da
 * GitHub e non da una simulazione.
 *
 * Rispetto alla versione PoC di questo file e' cambiata la premessa: il
 * repository non si digita piu' in due campi di testo liberi (owner e nome),
 * si sceglie da un elenco a discesa popolato da GitHub. "Repository
 * inesistente" non e' quindi piu' uno stato raggiungibile dall'interfaccia, e
 * al suo posto si verifica che l'elenco contenga solo repository reali e che
 * il branch — che invece si digita ancora — venga validato.
 */
test.describe("Percorsi d'errore nella creazione del contesto", () => {
  test.skip(!GITHUB_PAT, SKIP_REASON);

  test("RF.20 — l'elenco dei repository e' popolato da GitHub, non digitabile a mano", async ({
    page,
  }) => {
    await signedInWithCredentials(page);
    await page.goto("/select");

    const repositories = page.getByLabel("Repository");
    await expect(repositories).toBeEnabled({ timeout: 30_000 });

    // La voce segnaposto piu' almeno un repository vero: se l'elenco avesse
    // solo il segnaposto vorrebbe dire che la lettura da GitHub e' fallita in
    // silenzio, che e' esattamente il modo in cui questo passo puo' rompersi
    // senza che nulla lo dica.
    const options = repositories.locator("option");
    await expect(options.first()).toHaveText("-- Seleziona un repository --");
    expect(await options.count()).toBeGreaterThan(1);

    // Il pulsante di invio esiste sempre; e' il backend a rifiutare un
    // contesto senza repository. Si verifica che l'interfaccia non lasci
    // proseguire senza selezione.
    await page.getByRole("button", { name: "Salva contesto e vai ad Avvia" }).click();
    await expect(page).toHaveURL(/\/select$/);
  });

  test("RF.21 — branch inesistente: errore esplicito, nessun contesto creato", async ({ page }) => {
    await signedInWithCredentials(page);
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "branch-che-non-esiste-e2e",
      scope: "Repository completo",
    });

    // Resta dove sta e lo dice. Il caso in cui questo test serve davvero e'
    // quello in cui l'errore viene ingoiato e l'utente si ritrova su /run con
    // un contesto mai creato.
    await expect(page).toHaveURL(/\/select$/);
    await expect(page.getByText(/branch|riferimento|non trovat/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("RF.22 — commit che non appartiene al branch: rifiutato", async ({ page }) => {
    await signedInWithCredentials(page);
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "master",
      // SHA sintatticamente plausibile ma inesistente: il backend lo verifica
      // contro il branch (RF.17), non si limita a copiarlo nel contesto.
      commitSha: "0000000000000000000000000000000000000000",
      scope: "Repository completo",
    });

    await expect(page).toHaveURL(/\/select$/);
    await expect(page.getByText(/commit|non trovat|non appartiene/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("RF.29 — scope per file senza alcun percorso: rifiutato", async ({ page }) => {
    await signedInWithCredentials(page);
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "master",
      scope: "File specifici",
      paths: [],
    });

    await expect(page).toHaveURL(/\/select$/);
  });
});
