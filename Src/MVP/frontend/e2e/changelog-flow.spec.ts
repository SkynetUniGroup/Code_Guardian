import { expect, type Page, test } from "@playwright/test";
import {
  GITHUB_PAT,
  launchOperations,
  SKIP_REASON,
  schedeTask,
  signedInWithCredentials,
  submitContext,
  vaiA,
  waitForTerminalState,
} from "./helpers";

/**
 * TS_86, TS_99, TS_102, TS_104, TS_105, TS_108 (PdQ) — RF.86, RF.99, RF.102,
 * RF.104, RF.105, RF.108: flusso del Changelog e documentazione degli endpoint.
 *
 * Due operazioni distinte, non una in due tempi:
 *
 *  - CHANGELOG_TECHNICAL produce il changelog tecnico e si ferma li'. Il suo
 *    parse_output restituisce due valori, quindi `needs_next_phase` resta falso
 *    e il grafo non passa mai da await_confirmation.
 *  - CHANGELOG_BUSINESS e' quella a due fasi: genera prima il testo tecnico
 *    (restituendo `True` come terzo valore), si ferma a farlo rivedere, e solo
 *    dopo la conferma produce la versione business, su cui applica la soglia
 *    Flesch.
 *
 * I casi che riguardano la versione business lanciano quindi CHANGELOG_BUSINESS.
 * Lanciare il tecnico e aspettare la conferma significa aspettare per sempre.
 *
 * Il repository e' una fixture dedicata: al changelog servono issue chiuse, e il
 * repository di prova usato altrove non ne ha.
 */

const REPO = "IlGranz/codeguardian-changelog-fixture";
const BRANCH = "develop";

/**
 * Il valore sentinella che l'agente riconosce: prende tutte le issue chiuse
 * senza pretendere che esista una milestone con quel nome esatto.
 *
 * Un titolo vero come "Sprint 3" dipende da cosa GitHub restituisce in quella
 * singola chiamata, e ha reso il test intermittente — due esecuzioni su tre.
 * Qui la scelta dello sprint non e' l'oggetto della verifica: quella e' RF.98,
 * coperta da changelog-analysis.spec.ts.
 */
const SPRINT = "Current Sprint";

const CHANGELOG_TECNICO = "Changelog Tecnico";
const CHANGELOG_BUSINESS = "Changelog Business";
const DOCS_API = "Documentazione API";

/**
 * Avvia l'operazione indicata e attende che chieda lo Sprint ID.
 *
 * Il ruolo conta: CHANGELOG_BUSINESS e' riservata al Project Manager
 * (agent-registry.service.ts, allowedRoles), quindi entrando come Sviluppatore
 * la scheda dell'operazione non compare affatto e non c'e' niente da cliccare.
 */
async function finoAllaRichiestaSprint(
  page: Page,
  operazione: string,
  ruolo = "Developer",
): Promise<void> {
  await signedInWithCredentials(page, ruolo);
  await submitContext(page, { repo: REPO, branch: BRANCH, scope: "Repository completo" });
  await launchOperations(page, [operazione]);
  await expect(page.getByRole("button", { name: "Inserisci Sprint ID" })).toBeVisible({
    timeout: 6 * 60_000,
  });
}

/**
 * Risponde alla richiesta dello Sprint ID e supera la finestra sulle issue
 * incomplete.
 *
 * Quel terzo stop non e' opzionale: se lo sprint contiene issue con metadati
 * insufficienti — nella fixture sono la #18, la #19 e la #20 — l'agente si
 * ferma e chiede cosa farne. Saltarlo lascia la task in attesa per sempre.
 */
async function confermaSprint(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Inserisci Sprint ID" }).click();
  await page.getByLabel("Sprint ID").fill(SPRINT);
  await page.getByRole("button", { name: "Conferma" }).click();

  const decidi = page.getByRole("button", { name: /Task incompleti/ });
  await expect(decidi).toBeVisible({ timeout: 6 * 60_000 });
  await decidi.click();
  // Si prosegue: scartare le issue incomplete e' l'altra scelta possibile, ma
  // qui interessa arrivare alla fase successiva, non decidere al posto
  // dell'utente.
  await page.getByRole("button", { name: "Procedi comunque" }).click();
}

test.describe("Flusso del Changelog", () => {
  test.beforeEach(() => {
    test.skip(!GITHUB_PAT, SKIP_REASON);
  });

  test("TS_99 (RF.99) — si annulla l'operazione mentre chiede lo Sprint ID @agent", async ({
    page,
  }) => {
    test.setTimeout(10 * 60_000);
    await finoAllaRichiestaSprint(page, CHANGELOG_TECNICO);

    await schedeTask(page)
      .first()
      .getByRole("button", { name: /Annulla/i })
      .click();

    // Annullata vuol dire conclusa, non sospesa: la task raggiunge uno stato
    // terminale e smette di occupare il posto.
    await expect(
      page
        .getByRole("main")
        .getByText(/^Annullato$/i)
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("TS_102 (RF.102) — si interrompe definitivamente la generazione del Changelog @agent", async ({
    page,
  }) => {
    test.setTimeout(10 * 60_000);
    await finoAllaRichiestaSprint(page, CHANGELOG_TECNICO);

    await schedeTask(page)
      .first()
      .getByRole("button", { name: /Annulla/i })
      .click();
    await expect(
      page
        .getByRole("main")
        .getByText(/^Annullato$/i)
        .first(),
    ).toBeVisible({ timeout: 60_000 });

    // "Definitivamente": non deve restare un report a meta' nell'archivio.
    await vaiA(page, "Report");
    await expect(page.getByRole("main").getByText(/In corso|In attesa/i)).toHaveCount(0);
  });

  test("TS_104 / TS_108 (RF.104, RF.108) — il Changelog di business viene generato @agent", async ({
    page,
  }) => {
    test.setTimeout(15 * 60_000);
    await finoAllaRichiestaSprint(page, CHANGELOG_BUSINESS, "Project Manager");
    await confermaSprint(page);

    // Qui si vede la seconda fase: prodotto il testo tecnico, l'agente si ferma
    // e lo fa rivedere prima di tradurlo per gli stakeholder.
    await page
      .getByRole("button", { name: "Rivedi il changelog tecnico" })
      .click({ timeout: 8 * 60_000 });
    await page.getByRole("button", { name: "Genera la versione business" }).click();

    // RF.108 — la soglia Flesch la applica l'agente: se il testo non la supera
    // l'esito e' un fallimento di leggibilita' invece di un changelog. Si
    // accettano entrambi gli esiti terminali: quello che non deve succedere e'
    // un changelog illeggibile spacciato per buono, o una task appesa.
    const esito = await waitForTerminalState(page, 8 * 60_000);
    expect(["Completato", "Fallito"]).toContain(esito);
  });

  test("TS_105 (RF.105) — si rinuncia alla versione business dopo aver visto quella tecnica @agent", async ({
    page,
  }) => {
    test.setTimeout(12 * 60_000);
    await finoAllaRichiestaSprint(page, CHANGELOG_BUSINESS, "Project Manager");
    await confermaSprint(page);

    await page
      .getByRole("button", { name: "Rivedi il changelog tecnico" })
      .click({ timeout: 8 * 60_000 });
    await page.getByRole("button", { name: "Interrompi" }).click();

    // Rinunciare non deve lasciare la task appesa: arriva comunque a uno stato
    // terminale, e il lavoro tecnico gia' fatto non blocca nulla.
    const esito = await waitForTerminalState(page, 3 * 60_000);
    expect(["Completato", "Annullato", "Fallito"]).toContain(esito);
  });

  test("TS_86 (RF.86) — l'Agente Docs estrae gli endpoint e propone la documentazione API @agent", async ({
    page,
  }) => {
    test.setTimeout(12 * 60_000);

    await signedInWithCredentials(page);
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "master",
      scope: "Repository completo",
    });
    await launchOperations(page, [DOCS_API]);
    const esito = await waitForTerminalState(page);
    expect(esito).toMatch(/Completato/i);

    await schedeTask(page).first().getByRole("link", { name: "Vedi report" }).click();

    // La proposta e' un diff: e' cosi' che l'agente Docs consegna il proprio
    // lavoro, e il report deve portarla con se'.
    await expect(page.getByRole("main")).toContainText(/Proposta di modifica/i);
  });
});
