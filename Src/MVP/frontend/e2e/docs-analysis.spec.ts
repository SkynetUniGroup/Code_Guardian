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
 * TS/TA per l'Agente Docs, operazione DOCS_INLINE (RF.83, RF.84, RF.85).
 *
 * End-to-end reale: GitHub e LLM veri, nessun mock. Stesso repository e ambito
 * del test Security (OWASP/NodeGoat, app/routes/) per riuso e velocita'.
 *
 * A differenza di Security, che produce una lista di finding, Docs produce una
 * singola Proposta di modifica: un diff unificato (RF.63). E' quella che si
 * verifica, insieme al suo esito di pubblicazione — la Pull Request aperta dal
 * backend, o l'avviso che spiega perche' non lo e' stata (RF.72).
 *
 * L'operazione e' riservata al ruolo Developer: registrarsi con un altro ruolo
 * la farebbe semplicemente non comparire fra le schede di /run.
 */
test.describe("Agente Docs — documentazione inline su repository reale", () => {
  test.skip(!GITHUB_PAT, SKIP_REASON);
  test.setTimeout(8 * 60_000);

  test("@agent avvia DOCS_INLINE e mostra la proposta di diff", async ({ page }) => {
    await signedInWithCredentials(page, "Developer");
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "master",
      scope: "File specifici",
      paths: ["app/routes/index.js"],
    });

    await launchOperations(page, ["Inline documentation"]);
    const outcome = await waitForTerminalState(page);
    expect(outcome).toBe("Completato");

    await page.getByRole("link", { name: "Vedi report" }).click();
    await expect(page).toHaveURL(/\/reports\/[a-f0-9]{24}$/);

    // Il cuore di RF.63: una proposta, non un elenco di problemi.
    await expect(page.getByRole("heading", { name: "Proposta di modifica" })).toBeVisible();
    await page.getByRole("button", { name: /Mostra diff/ }).click();
    // Un diff unificato vero comincia con le righe di intestazione: cercare la
    // sola parola "diff" passerebbe anche su un testo qualsiasi.
    await expect(page.getByText(/^(---|\+\+\+|@@)/m).first()).toBeVisible();

    // RF.82/RF.63 sul lato pubblicazione: o c'e' il collegamento alla Pull
    // Request, o c'e' l'avviso che dice perche' non c'e'. Il silenzio — nessun
    // pulsante e nessuna spiegazione — e' il caso che questo test esclude.
    const pull_request_link = page.getByRole("link", { name: "Vedi PR" });
    const publish_warning = page.getByText(/Non è stato possibile aprire la Pull Request/);
    await expect(pull_request_link.or(publish_warning).first()).toBeVisible();
  });
});
