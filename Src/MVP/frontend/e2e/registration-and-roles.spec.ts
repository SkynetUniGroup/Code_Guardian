import { expect, test } from "@playwright/test";
import { freshEmail, PASSWORD, registerAndLogin } from "./helpers";

/**
 * TS_02 — TS_09 (PdQ) — RF.2..RF.9: registrazione, ruolo operativo e accesso.
 *
 * Nessuno di questi casi tocca GitHub o l'LLM: girano contro frontend, backend
 * e MongoDB e basta, quindi non si auto-skippano come gli spec che avviano
 * un'analisi. Sono i Test di Sistema che il Piano di Qualifica elencava come
 * progettati ma non implementati.
 */

/** Compila il modulo di registrazione lasciando al chiamante il submit. */
async function compilaRegistrazione(
  page: import("@playwright/test").Page,
  campi: {
    nome?: string;
    cognome?: string;
    email?: string;
    ruolo?: string;
    password?: string;
    conferma?: string;
  } = {},
) {
  await page.goto("/register");
  await page.getByLabel("Nome", { exact: true }).fill(campi.nome ?? "Marco");
  await page.getByLabel("Cognome").fill(campi.cognome ?? "Rossi");
  await page.getByLabel("Email").fill(campi.email ?? freshEmail());
  if (campi.ruolo) {
    await page.getByLabel("Ruolo").selectOption({ label: campi.ruolo });
  }
  await page.getByLabel("Password", { exact: true }).fill(campi.password ?? PASSWORD);
  await page.getByLabel("Conferma Password").fill(campi.conferma ?? campi.password ?? PASSWORD);
}

test.describe("Registrazione, ruolo e accesso", () => {
  test("TS_02 (RF.2) — nome e cognome si inseriscono in registrazione", async ({ page }) => {
    await page.goto("/register");

    const nome = page.getByLabel("Nome", { exact: true });
    const cognome = page.getByLabel("Cognome");
    await nome.fill("Marco");
    await cognome.fill("Rossi");

    // Non basta che i campi esistano: devono conservare quello che l'utente
    // scrive, altrimenti il dato non arriverebbe mai al backend.
    await expect(nome).toHaveValue("Marco");
    await expect(cognome).toHaveValue("Rossi");
  });

  test("TS_03 (RF.3) — email e password si inseriscono in registrazione", async ({ page }) => {
    await page.goto("/register");

    const email = page.getByLabel("Email");
    const password = page.getByLabel("Password", { exact: true });
    await email.fill("marco@azienda.it");
    await password.fill(PASSWORD);

    await expect(email).toHaveValue("marco@azienda.it");
    // La password non deve essere leggibile a schermo: il campo e' di tipo
    // password, non testo.
    await expect(password).toHaveAttribute("type", "password");
  });

  test("TS_04 (RF.4) — il ruolo operativo si sceglie fra i tre previsti", async ({ page }) => {
    await page.goto("/register");

    const ruolo = page.getByLabel("Ruolo");
    const opzioni = await ruolo.locator("option").allTextContents();
    expect(opzioni).toEqual(["Developer", "Security Auditor", "Project Manager"]);

    await ruolo.selectOption({ label: "Security Auditor" });
    await expect(ruolo).toHaveValue("SECURITY_AUDITOR");
  });

  test("TS_05 (RF.5) — un'email gia' registrata blocca la registrazione con un messaggio", async ({
    page,
  }) => {
    // Primo account: serve un'email che esista davvero, quindi la si crea.
    const account = await registerAndLogin(page);

    await compilaRegistrazione(page, { email: account.email });
    await page.getByRole("button", { name: "Registrati" }).click();

    await expect(page.getByText("Esiste già un account con questa email.")).toBeVisible();
    // E non deve aver aperto una sessione col secondo tentativo.
    await expect(page).toHaveURL(/\/register$/);
  });

  test("TS_06 (RF.6) — email malformata: errore, nessuna chiamata al backend", async ({ page }) => {
    await compilaRegistrazione(page, { email: "marco-chiocciola-azienda" });
    await page.getByRole("button", { name: "Registrati" }).click();

    await expect(page.getByText("Email non valida")).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("TS_06 (RF.6) — password debole: errore esplicito sul perche'", async ({ page }) => {
    // Due controlli distinti, e il messaggio deve dire quale dei due e' fallito:
    // "troppo corta" e "senza cifre" si correggono in modi diversi.
    await compilaRegistrazione(page, { password: "corta", conferma: "corta" });
    await page.getByRole("button", { name: "Registrati" }).click();
    await expect(page.getByText("La password deve essere di almeno 8 caratteri")).toBeVisible();

    await compilaRegistrazione(page, {
      password: "soltantolettere",
      conferma: "soltantolettere",
    });
    await page.getByRole("button", { name: "Registrati" }).click();
    await expect(
      page.getByText("La password deve contenere almeno una lettera e un numero"),
    ).toBeVisible();
  });

  test("TS_07 (RF.7) — il ruolo scelto determina cosa l'utente vede", async ({ page }) => {
    // La gestione del template README e' riservata allo Sviluppatore: e' la
    // differenza osservabile fra i ruoli nell'MVP (AppShell filtra la voce).
    await registerAndLogin(page, "Developer");
    const barra = page.getByRole("complementary", { name: "Navigazione principale" });
    await expect(barra.getByRole("link", { name: "Template" })).toBeVisible();

    await page.goto("/login");
    await registerAndLogin(page, "Project Manager");
    await expect(
      page
        .getByRole("complementary", { name: "Navigazione principale" })
        .getByRole("link", { name: "Template" }),
    ).toHaveCount(0);
  });

  test("TS_08 (RF.8) — si accede con email e password", async ({ page }) => {
    const account = await registerAndLogin(page);

    // Logout esplicito, poi rientro: e' il percorso che RF.8 descrive, non il
    // login implicito che la registrazione fa da sola.
    await page.getByRole("button", { name: "Esci" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Accedi" }).click();

    await expect(page).not.toHaveURL(/\/login$/);
  });

  test("TS_09 (RF.9) — credenziali errate: accesso negato con messaggio generico", async ({
    page,
  }) => {
    const account = await registerAndLogin(page);
    await page.getByRole("button", { name: "Esci" }).click();

    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill("password-sbagliata-1");
    await page.getByRole("button", { name: "Accedi" }).click();

    // Generico di proposito: distinguere "email inesistente" da "password
    // errata" direbbe a un attaccante quali indirizzi sono registrati.
    await expect(page.getByText("Email o password non corretti.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("TS_09 (RF.9) — un'email mai registrata riceve lo stesso messaggio", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(freshEmail("mai-visto"));
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Accedi" }).click();

    await expect(page.getByText("Email o password non corretti.")).toBeVisible();
  });
});
