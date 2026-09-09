import { expect, test } from "@playwright/test";
import { freshEmail, GITHUB_PAT, PASSWORD, registerAndLogin, SKIP_REASON } from "./helpers";

/**
 * TS_10 / TS_11 (PdQ) — RF.10, RF.11: accesso e configurazione del Personal
 * Access Token GitHub.
 *
 * Sostituisce setup.spec.ts, che pilotava la schermata `/setup` del PoC: un
 * campo di testo e un pulsante "Salva e Inizia" che nell'MVP non esistono
 * piu'. Qui la configurazione iniziale passa da un account vero
 * (registrazione, poi login) e da una pagina credenziali autenticata, dove il
 * token non viene solo salvato ma *verificato* contro GitHub.
 *
 * I casi di questo file non toccano ne' GitHub ne' l'LLM, tranne l'ultimo:
 * girano quindi anche senza E2E_GITHUB_PAT.
 */
test.describe("Accesso e credenziali", () => {
  test("un utente non autenticato che apre la radice finisce sul login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Accedi al tuo account")).toBeVisible();
  });

  test("la registrazione autentica e porta alle credenziali", async ({ page }) => {
    await registerAndLogin(page);
    await expect(page.getByRole("heading", { name: "Credenziali" })).toBeVisible();
    // Senza credenziale GitHub lo stato e' esplicito, non vuoto: e' quello che
    // dice all'utente perche' /select e /run non sono ancora raggiungibili.
    await expect(page.getByText("Non configurata")).toBeVisible();
  });

  test("senza credenziale GitHub le rotte operative rimandano alle credenziali", async ({
    page,
  }) => {
    await registerAndLogin(page);

    // La guardia sta su beforeLoad della rotta, non su un controllo dentro la
    // pagina: si verifica navigando, non cercando un messaggio.
    await page.goto("/select");
    await expect(page).toHaveURL(/\/credentials$/);

    await page.goto("/run");
    await expect(page).toHaveURL(/\/credentials$/);

    // /tasks e /reports invece restano raggiungibili: leggerli non richiede
    // GitHub, e chiuderli nasconderebbe all'utente il lavoro gia' svolto.
    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/tasks$/);
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/reports$/);
  });

  test("la registrazione rifiuta una password troppo corta senza chiamare il backend", async ({
    page,
  }) => {
    await page.goto("/register");
    await page.getByLabel("Nome", { exact: true }).fill("E2E");
    await page.getByLabel("Cognome").fill("Test");
    await page.getByLabel("Email").fill(freshEmail());
    await page.getByLabel("Password", { exact: true }).fill("corta");
    await page.getByLabel("Conferma Password").fill("corta");
    await page.getByRole("button", { name: "Registrati" }).click();

    await expect(page.getByText("La password deve essere di almeno 8 caratteri")).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("la registrazione rifiuta una email gia' usata", async ({ page }) => {
    const account = await registerAndLogin(page);

    await page.goto("/register");
    await page.getByLabel("Nome", { exact: true }).fill("E2E");
    await page.getByLabel("Cognome").fill("Bis");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Conferma Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Registrati" }).click();

    await expect(page.getByText("Esiste già un account con questa email.")).toBeVisible();
  });

  test("il login rifiuta una password sbagliata e accetta quella giusta", async ({ page }) => {
    const account = await registerAndLogin(page);

    // Esce dalla sessione appena creata passando dal pulsante vero, cosi' il
    // caso copre anche che l'uscita ripulisca davvero lo stato.
    await page.getByRole("button", { name: "Esci" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill("password-sbagliata");
    await page.getByRole("button", { name: "Accedi" }).click();
    await expect(page.getByText("Email o password non corretti.")).toBeVisible();

    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Accedi" }).click();
    // Il login porta a /select, che senza credenziale rimbalza su /credentials:
    // il risultato osservabile e' quello, non /select.
    await expect(page).toHaveURL(/\/credentials$/);
  });

  test("un token GitHub non valido viene rifiutato con un errore esplicito", async ({ page }) => {
    await registerAndLogin(page);

    await page.getByLabel(/GitHub Personal Access Token/).fill("ghp_token_finto_non_valido_0000");
    await page.getByRole("button", { name: "Salva e verifica" }).click();

    // La differenza sostanziale rispetto al PoC: il salvataggio non e' piu'
    // cieco. Il token viene provato contro GitHub e, se non vale, non entra.
    await expect(page.getByText(/non valid/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Connessa e valida")).toHaveCount(0);
  });

  test("RF.10/RF.11 — un PAT valido viene salvato, verificato e sblocca le rotte operative", async ({
    page,
  }) => {
    test.skip(!GITHUB_PAT, SKIP_REASON);

    await registerAndLogin(page);
    await page.getByLabel(/GitHub Personal Access Token/).fill(GITHUB_PAT as string);
    await page.getByRole("button", { name: "Salva e verifica" }).click();

    await expect(page.getByText("Connessa e valida")).toBeVisible({ timeout: 30_000 });
    // Il token non torna mai al browser dopo il salvataggio: si vede solo la
    // data dell'ultima validazione.
    await expect(page.getByText(/Ultima validazione:/)).toBeVisible();

    await page.goto("/select");
    await expect(page).toHaveURL(/\/select$/);
    await expect(page.getByRole("heading", { name: "Seleziona Repository" })).toBeVisible();
  });
});
