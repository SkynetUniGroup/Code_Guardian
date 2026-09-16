import { expect, test } from "@playwright/test";
import {
  GITHUB_PAT,
  SKIP_REASON,
  schedeTask,
  signedInWithCredentials,
  submitContext,
  waitForTerminalState,
} from "./helpers";

/**
 * TS_34, TS_36, TS_37, TS_39, TS_45, TS_48 (PdQ) — RF.34, RF.36, RF.37, RF.39,
 * RF.45, RF.48: scelta e avvio delle operazioni.
 *
 * La pagina /run e' raggiungibile solo con una credenziale GitHub verificata —
 * e' la guardia di rotta, non un dettaglio del test — quindi tutti questi casi
 * richiedono E2E_GITHUB_PAT. Quelli che avviano davvero un agente sono marcati
 * @agent e girano su Chromium soltanto.
 */

const REPO = "OWASP/NodeGoat";
const BRANCH = "master";

/**
 * Le schede di /run mostrano l'etichetta italiana di OPERATION_LABELS, non il
 * displayName inglese che GET /operations restituisce: e' la stessa che usano
 * TasksPage e ReportsPage, cosi' l'utente ritrova ovunque il nome con cui ha
 * scelto. Cercare qui il nome inglese non troverebbe nessun pulsante.
 */
const DOCS_README = "Documentazione README";
const DOCS_INLINE = "Documentazione Inline";

test.describe("Selezione e avvio delle operazioni", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!GITHUB_PAT, SKIP_REASON);
    await signedInWithCredentials(page);
    await submitContext(page, { repo: REPO, branch: BRANCH, scope: "Repository completo" });
    await expect(page).toHaveURL(/\/run$/);
  });

  test("TS_34 (RF.34) — ogni operazione porta con se' una descrizione di supporto", async ({
    page,
  }) => {
    // Non basta che i nomi ci siano: senza una riga che spieghi cosa fa, un
    // utente al primo accesso non ha modo di scegliere.
    const scheda = page.getByRole("button", { name: DOCS_README, exact: false }).first();
    await expect(scheda).toBeVisible();
    const testo = (await scheda.textContent()) ?? "";
    expect(testo.replace(DOCS_README, "").trim().length).toBeGreaterThan(20);
  });

  test("TS_36 (RF.36) — un'operazione si seleziona e si deseleziona", async ({ page }) => {
    const scheda = page.getByRole("button", { name: DOCS_README, exact: false }).first();
    // Il pulsante d'avvio cambia testo con la selezione: senza nulla scelto si
    // chiama "Seleziona almeno un'operazione". Va quindi cercato con entrambe
    // le forme, altrimenti a selezione vuota non lo si trova affatto.
    const avvio = page.getByRole("button", { name: /^(Avvia|Seleziona almeno)/ });

    // Stato di partenza: nessuna selezione, quindi niente da avviare.
    await expect(avvio).toBeDisabled();

    await scheda.click();
    await expect(avvio).toBeEnabled();

    // La deselezione e' esplicita quanto la selezione: si torna al punto di
    // partenza, non si resta bloccati con una scelta fatta per sbaglio.
    await scheda.click();
    await expect(avvio).toBeDisabled();
  });

  test("TS_37 (RF.37) — si selezionano piu' operazioni diverse in contemporanea", async ({
    page,
  }) => {
    await page.getByRole("button", { name: DOCS_README, exact: false }).first().click();
    await page.getByRole("button", { name: DOCS_INLINE, exact: false }).first().click();

    // L'etichetta del pulsante conta quante ne partiranno: e' il riscontro che
    // la selezione multipla e' stata recepita.
    await expect(page.getByRole("button", { name: "Avvia 2 operazioni" })).toBeEnabled();
  });

  test("TS_39 (RF.39) — piu' operazioni selezionate partono insieme @agent", async ({ page }) => {
    test.setTimeout(10 * 60_000);

    await page.getByRole("button", { name: DOCS_README, exact: false }).first().click();
    await page.getByRole("button", { name: DOCS_INLINE, exact: false }).first().click();
    await page.getByRole("button", { name: "Avvia 2 operazioni" }).click();

    await expect(page).toHaveURL(/\/tasks$/);
    // Due task, non uno: l'avvio contemporaneo non deve collassare in un solo
    // lavoro ne' perderne uno per strada.
    await expect(schedeTask(page)).toHaveCount(2);
  });

  test("TS_45 (RF.45) — durante l'elaborazione ogni operazione mostra il proprio nome @agent", async ({
    page,
  }) => {
    test.setTimeout(10 * 60_000);

    await page.getByRole("button", { name: DOCS_README, exact: false }).first().click();
    await page.getByRole("button", { name: "Avvia operazione" }).click();
    await expect(page).toHaveURL(/\/tasks$/);

    // Il nome deve essere leggibile mentre il lavoro e' in corso, non solo a
    // cose fatte: e' l'unico modo per capire quale delle operazioni avviate si
    // sta muovendo.
    await expect(schedeTask(page).first()).toContainText(DOCS_README);
  });

  test("TS_48 (RF.48) — il fallimento di una task non travolge le altre del batch @agent", async ({
    page,
  }) => {
    test.setTimeout(12 * 60_000);

    await page.getByRole("button", { name: DOCS_README, exact: false }).first().click();
    await page.getByRole("button", { name: DOCS_INLINE, exact: false }).first().click();
    await page.getByRole("button", { name: "Avvia 2 operazioni" }).click();
    await expect(page).toHaveURL(/\/tasks$/);

    await waitForTerminalState(page);

    // La proprieta' non e' "vanno bene tutte e due", che dipende dall'LLM:
    // e' che ciascuna arrivi a un esito suo. Un isolamento rotto lascerebbe la
    // seconda task appesa per sempre quando la prima cade.
    const esiti = page.getByRole("main").getByText(/^(Completato|Fallito|Annullato)$/i);
    await expect(esiti).toHaveCount(2, { timeout: 10 * 60_000 });
  });
});
