import { expect, type Page } from "@playwright/test";

/**
 * Shared utilities for the end-to-end specs.
 *
 * Everything here talks to the real MVP interface: routes `/register`,
 * `/login`, `/credentials`, `/select`, `/run`, `/tasks`, `/reports`. The
 * previous specs drove the PoC interface â a `/setup` screen with an "owner"
 * field and a "Save and Start" button â which the MVP no longer exposes since
 * repository selection moved to a dropdown and initial configuration to an
 * authenticated credentials page.
 */

/** The PAT used by specs that actually reach GitHub. */
export const GITHUB_PAT = process.env.E2E_GITHUB_PAT;

export const SKIP_REASON =
  "E2E_GITHUB_PAT not set in the .env at the monorepo root â see e2e/README.md";

/**
 * An email never seen before.
 *
 * Needed because registration is idempotent only in the wrong sense: on the
 * second attempt with the same email the backend responds 409 and the spec
 * would fail on the second run. The timestamp plus the counter make the email
 * unique even between two tests in the same file, which run in the same
 * millisecond.
 */
let account_counter = 0;
export function freshEmail(prefix = "e2e"): string {
  account_counter += 1;
  return `${prefix}-${Date.now()}-${account_counter}@codeguardian.test`;
}

export const PASSWORD = "e2eTest1234";

export interface Account {
  email: string;
  password: string;
}

/**
 * Registers a new user and leaves them authenticated on /credentials.
 *
 * Registration also performs the login (RegisterPage calls /auth/login right
 * after /auth/register) and lands on /credentials: that is where you end up,
 * not on /run, because without a GitHub credential the operational routes
 * redirect back.
 */
export async function registerAndLogin(page: Page, role = "Developer"): Promise<Account> {
  const account: Account = { email: freshEmail(), password: PASSWORD };

  await page.goto("/register");
  await page.getByLabel("First name", { exact: true }).fill("E2E");
  await page.getByLabel("Last name").fill("Test");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Role").selectOption({ label: role });
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByLabel("Confirm password").fill(account.password);
  await page.getByRole("button", { name: "Register" }).click();

  await expect(page).toHaveURL(/\/credentials$/);
  return account;
}

/**
 * Saves the PAT and waits for the backend to validate it against GitHub.
 *
 * Unlike the PoC, saving is no longer a blind write: the button is called
 * "Save and verify" and the credential is tested against the GitHub APIs
 * before being accepted. A fake token does not pass here â and that is why
 * every spec that goes beyond this point requires E2E_GITHUB_PAT.
 */
export async function saveGithubPat(page: Page, token: string): Promise<void> {
  await page.goto("/credentials");
  await page.getByLabel(/GitHub Personal Access Token/).fill(token);
  await page.getByRole("button", { name: "Save and verify" }).click();
  await expect(page.getByText("Connected and valid")).toBeVisible({ timeout: 30_000 });
}

/** Registration plus valid credential: the precondition of almost every spec. */
export async function signedInWithCredentials(page: Page, role?: string): Promise<Account> {
  const account = await registerAndLogin(page, role);
  await saveGithubPat(page, GITHUB_PAT as string);
  return account;
}

export interface ContextOptions {
  /** As it appears in the dropdown: "owner/name". */
  repo: string;
  branch: string;
  commitSha?: string;
  scope?: "Full repository" | "Specific files" | "Specific directories";
  /** One path per line, as in the textarea. */
  paths?: string[];
}

/**
 * Fills in the /select form and submits it.
 *
 * Does not assert the outcome: some specs expect to land on /run, others to
 * stay on /select with an error. Distinguishing the two is the caller's job.
 */
export async function submitContext(page: Page, options: ContextOptions): Promise<void> {
  await page.goto("/select");

  const repositories = page.getByLabel("Repository");
  await expect(repositories).toBeEnabled({ timeout: 30_000 });
  // By value and not by label: the label of a private repository has a
  // trailing lock icon, so it does not match "owner/name". The value does.
  await repositories.selectOption(options.repo);

  await page.getByLabel("Branch").fill(options.branch);
  if (options.commitSha !== undefined) {
    await page.getByLabel("Commit SHA (optional)").fill(options.commitSha);
  }
  if (options.scope) {
    await page.getByLabel("Scope type").selectOption({ label: options.scope });
  }
  if (options.paths) {
    const label =
      options.scope === "Specific files" ? "Files to analyze" : "Directories to analyze";
    await page.getByLabel(label).fill(options.paths.join("\n"));
  }

  await page.getByRole("button", { name: "Save context and go to Start" }).click();
}

/** Selects one or more operations on /run and launches them. */
export async function launchOperations(page: Page, operations: string[]): Promise<void> {
  await expect(page).toHaveURL(/\/run$/);
  for (const operation of operations) {
    await page.getByRole("button", { name: operation, exact: false }).first().click();
  }
  const label =
    operations.length === 1 ? "Start operation" : `Start ${operations.length} operations`;
  await page.getByRole("button", { name: label }).click();
  await expect(page).toHaveURL(/\/tasks$/);
}

/**
 * Waits for the Task at the top of the list to reach a terminal state and
 * returns it.
 *
 * The wait is on the status label and not on a network call because that is
 * what the user sees: progress arrives via WebSocket, and a test that queried
 * the API directly would not verify that the interface actually updates.
 */
export async function waitForTerminalState(page: Page, timeout = 6 * 60_000): Promise<string> {
  const card = page.getByRole("listitem").first();
  const terminal = card.getByText(/^(Completed|Failed|Cancelled)$/i);
  await expect(terminal).toBeVisible({ timeout });
  return ((await terminal.textContent()) ?? "").trim();
}
