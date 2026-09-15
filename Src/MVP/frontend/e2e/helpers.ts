import { expect, type Page } from "@playwright/test";

/**
 * Utilita' condivise dagli spec end-to-end.
 *
 * Tutto quello che sta qui parla all'interfaccia reale dell'MVP: rotte
 * `/register`, `/login`, `/credentials`, `/select`, `/run`, `/tasks`,
 * `/reports`. Gli spec precedenti pilotavano l'interfaccia del PoC — una
 * schermata `/setup` con un campo "owner" e un pulsante "Salva e Inizia" — che
 * l'MVP non espone piu' da quando la selezione del repository e' passata a un
 * elenco a discesa e la configurazione iniziale a una pagina credenziali
 * autenticata.
 */

/** Il PAT usato dagli spec che raggiungono davvero GitHub. */
export const GITHUB_PAT = process.env.E2E_GITHUB_PAT;

export const SKIP_REASON =
  "E2E_GITHUB_PAT non impostato nel .env alla radice del monorepo — vedi e2e/README.md";

/**
 * Un'email mai vista prima.
 *
 * Serve perche' la registrazione e' idempotente solo nel senso sbagliato: al
 * secondo tentativo con la stessa email il backend risponde 409 e lo spec
 * fallirebbe alla seconda esecuzione. Il timestamp piu' il contatore rendono
 * l'email unica anche fra due test dello stesso file, che girano nello stesso
 * millisecondo.
 */
let account_counter = 0;
export function freshEmail(prefix = "e2e"): string {
  account_counter += 1;
  return `${prefix}-${Date.now()}-${account_counter}@codeguardian.test`;
}

export const PASSWORD = "e2eTest1234";

/**
 * Naviga cliccando la voce della barra laterale, non con `page.goto`.
 *
 * `page.goto` e' un ricaricamento completo, e la sessione di Code Guardian vive
 * solo in memoria — mai in localStorage, per scelta dichiarata in sessionStore.
 * Un reload quindi disautentica e fa finire sul login: gli helper che usavano
 * goto portavano ogni spec a fallire su un'asserzione che con il caso in esame
 * non c'entrava nulla. Cliccare il link e' anche il percorso reale dell'utente.
 */
export async function vaiA(page: Page, voce: string): Promise<void> {
  await page
    .getByRole("complementary", { name: "Navigazione principale" })
    .getByRole("link", { name: voce })
    .click();
}

export interface Account {
  email: string;
  password: string;
}

/**
 * Registra un nuovo utente e lo lascia autenticato su /credentials.
 *
 * La registrazione fa da sola anche il login (RegisterPage chiama /auth/login
 * subito dopo /auth/register) e porta a /credentials: e' li' che si arriva, non
 * su /run, perche' senza una credenziale GitHub le rotte operative rimandano
 * indietro.
 */
export async function registerAndLogin(page: Page, role = "Developer"): Promise<Account> {
  const account: Account = { email: freshEmail(), password: PASSWORD };

  await page.goto("/register");
  await page.getByLabel("Nome", { exact: true }).fill("E2E");
  await page.getByLabel("Cognome").fill("Test");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Ruolo").selectOption({ label: role });
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByLabel("Conferma Password").fill(account.password);
  await page.getByRole("button", { name: "Registrati" }).click();

  await expect(page).toHaveURL(/\/credentials$/);
  return account;
}

/**
 * Salva il PAT e aspetta che il backend lo abbia validato contro GitHub.
 *
 * A differenza del PoC il salvataggio non e' piu' una scrittura cieca: il
 * pulsante si chiama "Salva e verifica" e la credenziale viene provata contro
 * le API di GitHub prima di essere accettata. Un token finto qui non passa —
 * ed e' il motivo per cui ogni spec che arriva oltre questo punto richiede
 * E2E_GITHUB_PAT.
 */
export async function saveGithubPat(page: Page, token: string): Promise<void> {
  await vaiA(page, "Credenziali");
  await page.getByLabel(/GitHub Personal Access Token/).fill(token);
  await page.getByRole("button", { name: "Salva e verifica" }).click();
  await expect(page.getByText("Connessa e valida")).toBeVisible({ timeout: 30_000 });
}

/** Registrazione piu' credenziale valida: la precondizione di quasi tutti gli spec. */
export async function signedInWithCredentials(page: Page, role?: string): Promise<Account> {
  const account = await registerAndLogin(page, role);
  await saveGithubPat(page, GITHUB_PAT as string);
  return account;
}

export interface ContextOptions {
  /** Come compare nell'elenco a discesa: "owner/nome". */
  repo: string;
  branch: string;
  commitSha?: string;
  scope?: "Repository completo" | "File specifici" | "Directory specifiche";
  /** Un percorso per riga, come nel textarea. */
  paths?: string[];
}

/**
 * Compila il modulo di /select e lo invia.
 *
 * Non asserisce l'esito: alcuni spec si aspettano di arrivare su /run, altri di
 * restare su /select con un errore. Distinguere le due cose e' compito del
 * chiamante.
 */
export async function submitContext(page: Page, options: ContextOptions): Promise<void> {
  await vaiA(page, "Repository");

  const repositories = page.getByLabel("Seleziona repository");
  await expect(repositories).toBeEnabled({ timeout: 30_000 });

  // La tendina elenca i repository dell'account a cui appartiene il PAT: un
  // repository pubblico di terzi — OWASP/NodeGoat, che quasi tutti gli spec
  // usano — non ci compare. Per quello esiste il campo dell'URL manuale, ed e'
  // il percorso che un utente segue davvero in questo caso. Si sceglie in base
  // a cosa la tendina offre, invece di dare per scontato l'uno o l'altro.
  const disponibili = await repositories
    .locator("option")
    .evaluateAll((opzioni) => opzioni.map((o) => (o as HTMLOptionElement).value));

  if (disponibili.includes(options.repo)) {
    // Per valore e non per etichetta: l'etichetta di un repository privato
    // porta in coda un lucchetto, quindi non coincide con "owner/nome".
    await repositories.selectOption(options.repo);
  } else {
    await page
      .getByLabel("Oppure incolla l'URL di un repository pubblico")
      .fill(`https://github.com/${options.repo}`);
  }

  await page.getByLabel("Branch").fill(options.branch);
  if (options.commitSha !== undefined) {
    await page.getByLabel("Commit SHA (opzionale)").fill(options.commitSha);
  }
  if (options.scope) {
    await page.getByLabel("Tipo di scope").selectOption({ label: options.scope });
  }
  if (options.paths) {
    const label =
      options.scope === "File specifici" ? "File da analizzare" : "Directory da analizzare";
    await page.getByLabel(label).fill(options.paths.join("\n"));
  }

  await page.getByRole("button", { name: "Salva contesto e vai ad Avvia" }).click();
}

/**
 * Le schede delle task, e solo quelle.
 *
 * `page.getByRole("listitem")` da solo non basta: anche la barra laterale e' un
 * `<ul>` di `<li>`, quindi il primo listitem della pagina e' la voce
 * "Credenziali" del menu, non la prima task. Restringere a `main` e' la
 * differenza fra guardare il contenuto e guardare la navigazione.
 */
export function schedeTask(page: Page) {
  return page.getByRole("main").getByRole("listitem");
}

/** Seleziona una o piu' operazioni su /run e le avvia. */
export async function launchOperations(page: Page, operations: string[]): Promise<void> {
  await expect(page).toHaveURL(/\/run$/);
  for (const operation of operations) {
    await page.getByRole("button", { name: operation, exact: false }).first().click();
  }
  const label =
    operations.length === 1 ? "Avvia operazione" : `Avvia ${operations.length} operazioni`;
  await page.getByRole("button", { name: label }).click();
  await expect(page).toHaveURL(/\/tasks$/);
}

/**
 * Aspetta che il Task in cima all'elenco raggiunga uno stato terminale e lo
 * restituisce.
 *
 * L'attesa e' sull'etichetta di stato e non su una chiamata di rete perche' e'
 * quello che vede l'utente: l'avanzamento arriva via WebSocket, e un test che
 * interrogasse l'API direttamente non verificherebbe che l'interfaccia si
 * aggiorni davvero.
 */
export async function waitForTerminalState(page: Page, timeout = 6 * 60_000): Promise<string> {
  const card = schedeTask(page).first();
  const terminal = card.getByText(/^(Completato|Fallito|Annullato)$/i);
  await expect(terminal).toBeVisible({ timeout });
  return ((await terminal.textContent()) ?? "").trim();
}
