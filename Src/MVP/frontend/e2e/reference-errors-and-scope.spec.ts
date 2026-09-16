import { expect, test } from "@playwright/test";
import { GITHUB_PAT, SKIP_REASON, signedInWithCredentials, submitContext } from "./helpers";

/**
 * Test di Sistema sulla selezione del riferimento e dell'ambito, reali
 * (nessun mock).
 *
 * Nota di implementazione, aggiornata rispetto alla versione PoC di questo
 * file: li' branch e commit erano un unico campo "Ref" e RF.21/RF.22
 * collassavano nello stesso comportamento osservabile. Nell'MVP sono due campi
 * distinti — "Branch" e "Commit SHA (opzionale)" — quindi i due requisiti sono
 * ora verificabili separatamente, e lo sono in repository-errors.spec.ts.
 * Resta invece vero che non esiste alcun selettore per le Pull Request, e che
 * RF.23/RF.18 non sono percio' testabili da interfaccia.
 */
test.describe("Riferimento e ambito", () => {
  test.skip(!GITHUB_PAT, SKIP_REASON);

  test("RF.17 — omettere il commit ancora l'analisi all'HEAD del branch", async ({ page }) => {
    await signedInWithCredentials(page);
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "master",
      commitSha: "",
      scope: "Directory specifiche",
      paths: ["app/routes"],
    });

    await expect(page).toHaveURL(/\/run$/);
    // Lo SHA risolto compare nel riepilogo del contesto: e' la prova che
    // l'ancoraggio e' avvenuto e non e' rimasto vuoto.
    await expect(page.getByText(/^SHA: [0-9a-f]{8}/)).toBeVisible();
  });

  test("RF.26/UC16.1 — scope sull'intero repository: il contesto si crea", async ({ page }) => {
    await signedInWithCredentials(page);
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "master",
      scope: "Repository completo",
    });

    await expect(page).toHaveURL(/\/run$/);
    await expect(page.getByText(/Scope: FULL_REPOSITORY/)).toBeVisible();
  });

  test("RF.27 — ambito ristretto a un singolo file", async ({ page }) => {
    await signedInWithCredentials(page);
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "master",
      scope: "File specifici",
      paths: ["app/routes/index.js"],
    });

    await expect(page).toHaveURL(/\/run$/);
    await expect(page.getByText(/Scope: FILES/)).toBeVisible();
    await expect(page.getByText(/1 file stimati/)).toBeVisible();
  });

  test("RF.24 — i linguaggi rilevati compaiono nel riepilogo del contesto", async ({ page }) => {
    await signedInWithCredentials(page);
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "master",
      scope: "Directory specifiche",
      paths: ["app/routes"],
    });

    await expect(page).toHaveURL(/\/run$/);
    await expect(page.getByText(/javascript/)).toBeVisible();
  });

  test("RF.30/UC18 — directory inesistente in un repository valido: nessun file nello scope", async ({
    page,
  }) => {
    await signedInWithCredentials(page);
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "master",
      scope: "Directory specifiche",
      paths: ["cartella/che/non/esiste"],
    });

    // Due esiti ammessi, e sono entrambi corretti: o il backend rifiuta lo
    // scope, o crea un contesto con zero file stimati. Quello che non deve
    // succedere e' arrivare su /run con una stima non nulla, cioe' con uno
    // scope che l'utente crede popolato e non lo e'.
    if (/\/run$/.test(page.url())) {
      await expect(page.getByText(/0 file stimati/)).toBeVisible();
    } else {
      await expect(page).toHaveURL(/\/select$/);
    }
  });
});
