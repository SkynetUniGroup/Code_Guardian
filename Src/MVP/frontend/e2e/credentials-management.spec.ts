import { expect, test } from "@playwright/test";
import { GITHUB_PAT, registerAndLogin, SKIP_REASON, saveGithubPat } from "./helpers";

/**
 * TS_12 — TS_14 (PdQ) — RF.12, RF.13, RF.14: inserimento e verifica del token
 * del servizio esterno.
 *
 * TS_14 riguarda la validazione fatta in locale, prima di qualunque chiamata:
 * gira sempre. TS_12 e TS_13 riguardano la verifica contro GitHub, quindi
 * richiedono E2E_GITHUB_PAT e si saltano da soli quando manca — come tutti gli
 * spec che raggiungono davvero il servizio esterno.
 */
test.describe("Credenziali dei servizi esterni", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await expect(page.getByRole("heading", { name: "Credenziali" })).toBeVisible();
  });

  test("TS_14 (RF.14) — un campo token vuoto viene rifiutato senza contattare GitHub", async ({
    page,
  }) => {
    // La guardia e' locale: nessuna richiesta parte, e il messaggio compare
    // subito. Si verifica intercettando la rete, non a occhio.
    let chiamate = 0;
    await page.route("**/api/v1/credentials", (route) => {
      chiamate += 1;
      return route.continue();
    });

    await page.getByRole("button", { name: "Salva e verifica" }).click();

    await expect(page.getByText("Inserisci il GitHub Personal Access Token")).toBeVisible();
    expect(chiamate, "nessuna POST deve partire per un campo vuoto").toBe(0);
  });

  test("TS_14 (RF.14) — lo stato iniziale della credenziale e' dichiarato, non vuoto", async ({
    page,
  }) => {
    // "Non configurata" e' un'informazione: dice all'utente perche' /select e
    // /run lo rimandano indietro. Una casella vuota non lo direbbe.
    await expect(page.getByText("Non configurata")).toBeVisible();
  });

  test("TS_13 (RF.13) — un token sintatticamente valido ma rifiutato da GitHub non viene salvato", async ({
    page,
  }) => {
    // Nessun PAT richiesto qui: serve proprio un token *finto*. La verifica
    // contro GitHub e' il punto del caso, e un token inventato la fallisce.
    await page
      .getByLabel(/GitHub Personal Access Token/)
      .fill("ghp_0000000000000000000000000000000000");
    await page.getByRole("button", { name: "Salva e verifica" }).click();

    // Il messaggio arriva dal backend dopo il tentativo: l'attesa e' lunga
    // perche' include il viaggio verso GitHub.
    await expect(page.getByRole("alert").or(page.getByText(/rifiutato|non valid/i))).toBeVisible({
      timeout: 30_000,
    });
    // E lo stato non deve essere passato a "connessa": la memorizzazione si
    // interrompe, come RF.13 richiede.
    await expect(page.getByText("Connessa e valida")).toHaveCount(0);
  });

  test("TS_12 (RF.12) — un token valido viene accettato e abilita il flusso operativo", async ({
    page,
  }) => {
    test.skip(!GITHUB_PAT, SKIP_REASON);

    await saveGithubPat(page, GITHUB_PAT as string);

    await expect(page.getByText("Connessa e valida")).toBeVisible();
    // La conferma non e' solo estetica: da qui in poi /select deve aprirsi,
    // ed e' la differenza fra "salvato" e "utilizzabile".
    await page
      .getByRole("complementary", { name: "Navigazione principale" })
      .getByRole("link", { name: "Repository" })
      .click();
    await expect(page).toHaveURL(/\/select$/);
  });

  test("TS_13 (RF.13) — una credenziale salvata si puo' ri-verificare su richiesta", async ({
    page,
  }) => {
    test.skip(!GITHUB_PAT, SKIP_REASON);

    await saveGithubPat(page, GITHUB_PAT as string);
    await page.getByRole("button", { name: "Verifica di nuovo" }).click();

    await expect(page.getByText("La credenziale è ancora valida.")).toBeVisible({
      timeout: 30_000,
    });
  });
});
