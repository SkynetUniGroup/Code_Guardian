import { expect, test } from "@playwright/test";
import { GITHUB_PAT, registerAndLogin, SKIP_REASON, saveGithubPat, vaiA } from "./helpers";

/**
 * TS_19 (PdQ) — RF.19: validazione locale dell'URL del repository.
 *
 * Il controllo sul formato avviene prima di qualunque chiamata, quindi si
 * verifica anche contando le richieste che non partono.
 */
test.describe("Riferimento di base dell'analisi", () => {
  test("TS_19 (RF.19) — un URL dal formato errato viene respinto in locale", async ({ page }) => {
    test.skip(!GITHUB_PAT, SKIP_REASON);

    await registerAndLogin(page);
    await saveGithubPat(page, GITHUB_PAT as string);
    await vaiA(page, "Repository");

    // Nessuna richiesta deve partire: il formato si controlla prima, ed e'
    // quello che RF.19 chiama "validazione locale".
    let chiamate = 0;
    await page.route("**/api/v1/contexts", (route) => {
      chiamate += 1;
      return route.continue();
    });

    const campoUrl = page.getByLabel("Oppure incolla l'URL di un repository pubblico");
    for (const urlNonValido of [
      "https://gitlab.com/owner/repo",
      "http://github.com/owner/repo",
      "https://github.com/solo-owner",
      "non-un-url",
    ]) {
      await campoUrl.fill(urlNonValido);
      await page.getByRole("button", { name: "Salva contesto e vai ad Avvia" }).click();

      await expect(page.getByText("URL non valido (https://github.com/owner/repo)")).toBeVisible();
      await expect(page).toHaveURL(/\/select$/);
    }

    expect(chiamate, "nessun contesto deve essere inviato per un URL malformato").toBe(0);
  });

  test("TS_19 (RF.19) — l'URL nella forma ammessa viene accettato", async ({ page }) => {
    test.skip(!GITHUB_PAT, SKIP_REASON);

    await registerAndLogin(page);
    await saveGithubPat(page, GITHUB_PAT as string);
    await vaiA(page, "Repository");

    // Il complemento del caso sopra: la validazione non deve essere cosi'
    // stretta da rifiutare anche quello che va bene.
    await page
      .getByLabel("Oppure incolla l'URL di un repository pubblico")
      .fill("https://github.com/OWASP/NodeGoat");
    await page.getByLabel("Branch").fill("master");
    await page.getByRole("button", { name: "Salva contesto e vai ad Avvia" }).click();

    await expect(page).toHaveURL(/\/run$/, { timeout: 30_000 });
  });
});
