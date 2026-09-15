import { expect, type Page, test } from "@playwright/test";
import { GITHUB_PAT, registerAndLogin, SKIP_REASON, saveGithubPat, vaiA } from "./helpers";

/**
 * TS_66 — TS_71, TS_109 (PdQ) — RF.66, RF.67, RF.68, RF.69, RF.71, RF.109:
 * come l'interfaccia reagisce ai fallimenti dell'agente e del modello.
 *
 * Questi errori si provocano, non si aspettano. Un timeout del modello, un
 * output non parsabile, un contesto oltre la capacita': attenderli sul serio
 * vorrebbe dire dipendere dal caso — un giorno il modello risponde in tempo e
 * il test diventa verde senza che nulla sia stato verificato. L'errore si
 * inietta quindi sulla risposta del backend, con lo stesso codice che il
 * backend userebbe davvero (ErrorKind del contratto condiviso), e si verifica
 * cio' che RF chiede: che l'utente lo veda e che l'applicazione non si rompa.
 *
 * Serve comunque una credenziale valida per arrivare alla schermata di avvio.
 */

const REPO_URL = "https://github.com/OWASP/NodeGoat";
const BRANCH = "master";

/** Porta l'utente su /run, pronto ad avviare un'operazione. */
async function prontoPerAvviare(page: Page): Promise<void> {
  await registerAndLogin(page);
  await saveGithubPat(page, GITHUB_PAT as string);
  await vaiA(page, "Repository");
  await page.getByLabel("Oppure incolla l'URL di un repository pubblico").fill(REPO_URL);
  await page.getByLabel("Branch").fill(BRANCH);
  await page.getByRole("button", { name: "Salva contesto e vai ad Avvia" }).click();
  await expect(page).toHaveURL(/\/run$/, { timeout: 30_000 });
}

/** Fa rispondere POST /tasks con l'errore indicato, come farebbe il backend. */
async function rispondiConErrore(
  page: Page,
  stato: number,
  corpo: { code: string; message: string },
): Promise<void> {
  await page.route("**/api/v1/tasks", async (route) => {
    if (route.request().method() !== "POST") {
      return route.continue();
    }
    return route.fulfill({
      status: stato,
      contentType: "application/json",
      body: JSON.stringify(corpo),
    });
  });
}

test.describe("Fallimenti dell'agente e del modello", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!GITHUB_PAT, SKIP_REASON);
    await prontoPerAvviare(page);
  });

  test("TS_66 (RF.66) — superato il tetto mensile, l'avvio e' bloccato con un messaggio", async ({
    page,
  }) => {
    // 429 USAGE_LIMIT_EXCEEDED e' esattamente cio' che il backend restituisce
    // quando il controllo del tetto scatta prima dell'accodamento (TI_15).
    await rispondiConErrore(page, 429, {
      code: "USAGE_LIMIT_EXCEEDED",
      message: "Hai raggiunto il limite mensile di operazioni.",
    });

    await page.getByRole("button", { name: "Documentazione README" }).first().click();
    await page.getByRole("button", { name: "Avvia operazione" }).click();

    await expect(page.getByText(/limite mensile|USAGE_LIMIT/i)).toBeVisible();
    // Bloccato "preventivamente": non si finisce sulla lista delle task,
    // perche' non ne e' stata accodata nessuna.
    await expect(page).toHaveURL(/\/run$/);
  });

  test("TS_67 (RF.67) — un modello che non risponde produce un errore, non un'attesa infinita", async ({
    page,
  }) => {
    await rispondiConErrore(page, 504, {
      code: "TIMEOUT",
      message: "Il modello non ha risposto entro il tempo massimo.",
    });

    await page.getByRole("button", { name: "Documentazione README" }).first().click();
    await page.getByRole("button", { name: "Avvia operazione" }).click();

    // Il messaggio e' quello generico, non "TIMEOUT": RunPage distingue per
    // stato HTTP solo 429, 403 e 404, e per il resto dice all'utente che
    // l'avvio non e' riuscito. La diagnosi precisa del fallimento del modello
    // compare sulla task, non qui — l'accodamento non aspetta l'agente. Cio'
    // che RF.67 chiede a questo livello e' che l'attesa finisca e l'utente
    // venga avvisato, ed e' quello che si verifica.
    await expect(page.getByText("Errore durante l'avvio delle operazioni. Riprova.")).toBeVisible();
    // Il pulsante torna utilizzabile: si puo' riprovare invece di restare con
    // l'interfaccia bloccata sullo stato "in corso".
    await expect(page.getByRole("button", { name: "Avvia operazione" })).toBeEnabled();
  });

  test("TS_68 (RF.68) — un output non interpretabile blocca l'elaborazione e lo dichiara", async ({
    page,
  }) => {
    await rispondiConErrore(page, 502, {
      code: "PARSING",
      message: "La risposta del modello non è interpretabile.",
    });

    await page.getByRole("button", { name: "Documentazione README" }).first().click();
    await page.getByRole("button", { name: "Avvia operazione" }).click();

    await expect(page.getByText("Errore durante l'avvio delle operazioni. Riprova.")).toBeVisible();
    // L'elaborazione e' bloccata: nessuna task accodata, si resta su /run.
    await expect(page).toHaveURL(/\/run$/);
  });

  test("TS_69 (RF.69) — un contesto oltre la capacita' si ferma prima dell'invio", async ({
    page,
  }) => {
    await rispondiConErrore(page, 413, {
      code: "CONTEXT_TOO_LARGE",
      message: "Il contesto selezionato eccede la capacità del modello.",
    });

    await page.getByRole("button", { name: "Documentazione README" }).first().click();
    await page.getByRole("button", { name: "Avvia operazione" }).click();

    await expect(page.getByText("Errore durante l'avvio delle operazioni. Riprova.")).toBeVisible();
    await expect(page).toHaveURL(/\/run$/);
  });

  test("TS_71 (RF.71) — una risorsa di contesto illeggibile blocca l'agente e avvisa", async ({
    page,
  }) => {
    await rispondiConErrore(page, 422, {
      code: "CONTEXT_RESOURCE_INVALID",
      message: "Una risorsa del contesto è illeggibile o malformata.",
    });

    await page.getByRole("button", { name: "Documentazione README" }).first().click();
    await page.getByRole("button", { name: "Avvia operazione" }).click();

    await expect(page.getByText("Errore durante l'avvio delle operazioni. Riprova.")).toBeVisible();
  });

  test("TS_109 (RF.109) — un 429 del provider LLM non lascia l'interfaccia bloccata", async ({
    page,
  }) => {
    // Diverso da TS_66: li' il 429 e' nostro, del tetto di utilizzo; qui viene
    // dal fornitore del modello e arriva incapsulato come UPSTREAM. In entrambi
    // i casi la proprieta' da garantire e' che l'applicazione resti usabile.
    await rispondiConErrore(page, 503, {
      code: "UPSTREAM",
      message: "Il provider del modello ha risposto 429: riprova fra qualche minuto.",
    });

    await page.getByRole("button", { name: "Documentazione README" }).first().click();
    await page.getByRole("button", { name: "Avvia operazione" }).click();

    await expect(page.getByText("Errore durante l'avvio delle operazioni. Riprova.")).toBeVisible();
    // Navigabile: l'errore non deve aver lasciato la pagina in uno stato morto.
    await vaiA(page, "Report");
    await expect(page).toHaveURL(/\/reports$/);
  });
});
