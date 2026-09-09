import { expect, test } from "@playwright/test";
import {
  GITHUB_PAT,
  launchOperations,
  SKIP_REASON,
  signedInWithCredentials,
  submitContext,
  waitForTerminalState,
} from "./helpers";

/**
 * TS/TA per l'Agente Changelog, operazione CHANGELOG_TECHNICAL (RF.94-97).
 *
 * End-to-end reale sul repository pubblico del gruppo stesso
 * (SkynetUniGroup/Code_Guardian), che ha issue chiuse vere di tutti gli sprint
 * del Piano di Progetto: a differenza di Security e Docs qui l'agente non
 * legge codice sorgente, legge le Issue di GitHub.
 *
 * Due comportamenti anomali erano documentati nella versione PoC di questo
 * file. Il primo e' cambiato, il secondo no:
 * 1. RF.98 (scelta dello Sprint) non era esprimibile da interfaccia. Nell'MVP
 *    lo Sprint ID viene chiesto quando serve, con una finestra di dialogo
 *    aperta dalla scheda del Task: e' il caso "Inserisci Sprint ID" qui sotto.
 * 2. La creazione del contesto valida comunque numero di file e linguaggio
 *    dello scope anche per Changelog, che non legge codice. Si usa percio' uno
 *    scope minimo solo per superare quella validazione e arrivare all'agente.
 *
 * L'operazione e' consentita a Project Manager e Developer.
 */
test.describe("Agente Changelog — changelog tecnico da Issue reali", () => {
  test.skip(!GITHUB_PAT, SKIP_REASON);
  test.setTimeout(8 * 60_000);

  test("@agent avvia CHANGELOG_TECHNICAL e produce il changelog dello sprint", async ({ page }) => {
    await signedInWithCredentials(page, "Project Manager");
    await submitContext(page, {
      repo: "SkynetUniGroup/Code_Guardian",
      branch: "develop",
      scope: "Directory specifiche",
      paths: ["Website"],
    });

    await launchOperations(page, ["Technical changelog"]);

    // RF.98: l'agente si sospende e chiede lo Sprint ID. La finestra si apre
    // dalla scheda del Task, non compare da sola.
    const sprint_button = page.getByRole("button", { name: "Inserisci Sprint ID" });
    await expect(sprint_button).toBeVisible({ timeout: 3 * 60_000 });
    await sprint_button.click();
    await page.getByLabel("Sprint ID").fill("SPRINT-1");
    await page.getByRole("button", { name: "Conferma" }).click();

    const outcome = await waitForTerminalState(page);
    expect(outcome).toBe("Completato");

    await page.getByRole("link", { name: "Vedi report" }).click();
    await expect(page.getByRole("heading", { name: "Changelog Tecnico" })).toBeVisible();
    // Il changelog e' fatto di voci con un riferimento all'issue: un report
    // senza nemmeno un riferimento vorrebbe dire che le Issue non sono state
    // lette, non che lo sprint era vuoto.
    await expect(page.getByText(/#\d+/).first()).toBeVisible();
  });
});
