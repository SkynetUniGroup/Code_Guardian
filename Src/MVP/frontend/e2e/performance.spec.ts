import { expect, test } from "@playwright/test";
import { PASSWORD, registerAndLogin } from "./helpers";

/**
 * TS_110, TS_111 (PdQ) — RF.110, RF.111: i due tetti di reattivita'.
 *
 * Misurano tempi, quindi vanno letti per quello che sono: una soglia larga
 * (2 secondi) su una macchina di sviluppo, non un benchmark. Servono a
 * intercettare una regressione grossolana — una chiamata sincrona di troppo,
 * un'attesa di rete dove non dovrebbe essercene — non a certificare una
 * latenza. Per questo la soglia e' una costante dichiarata e non un numero
 * sparso nelle asserzioni.
 *
 * Nessuno dei due tocca GitHub o l'LLM.
 */

/** Il tetto di RF.110 e RF.111, in millisecondi. */
const TETTO_MS = 2000;

test.describe("Reattivita' dell'interfaccia", () => {
  test("TS_110 (RF.110) — l'autenticazione si conclude entro 2 secondi", async ({ page }) => {
    const account = await registerAndLogin(page);
    await page.getByRole("button", { name: "Esci" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(PASSWORD);

    // Il cronometro parte al click e si ferma quando l'utente non e' piu' sul
    // login: e' quello che percepisce, non la durata della sola richiesta HTTP.
    // Dentro ci sono l'hashing Argon2id lato backend, l'emissione del token e
    // il cambio di rotta.
    const inizio = Date.now();
    await page.getByRole("button", { name: "Accedi" }).click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: TETTO_MS });
    const durata = Date.now() - inizio;

    expect(durata, `autenticazione in ${durata} ms`).toBeLessThan(TETTO_MS);
  });

  test("TS_111 (RF.111) — un'azione dell'utente produce un riscontro entro 2 secondi", async ({
    page,
  }) => {
    await registerAndLogin(page);
    const barra = page.getByRole("complementary", { name: "Navigazione principale" });

    // Tre azioni diverse, non una: una sola misura direbbe poco, e il caso che
    // interessa e' che nessuna schermata raggiungibile sfori.
    for (const [link, intestazione] of [
      ["Report", "Storico Report"],
      ["Task", "Task"],
      ["Credenziali", "Credenziali"],
    ] as const) {
      const inizio = Date.now();
      await barra.getByRole("link", { name: link }).click();
      await expect(page.getByRole("heading", { name: intestazione }).first()).toBeVisible({
        timeout: TETTO_MS,
      });
      const durata = Date.now() - inizio;

      expect(durata, `"${link}" ha risposto in ${durata} ms`).toBeLessThan(TETTO_MS);
    }
  });
});
