import { expect, test } from "@playwright/test";

/**
 * TS_10 / TS_11 (PdQ) â RF.10, RF.11: initial configuration of the GitHub
 * Personal Access Token. System Test: runs in the browser against the REAL
 * stack (frontend + backend + MongoDB), not against mocks â see
 * playwright.config.ts and TESTING.md.
 *
 * No real PAT/LLM_API_KEY needed: saving the credential encrypts it and
 * writes it to MongoDB without validating it against the GitHub APIs
 * (separate validation endpoint, opt-in â see
 * backend/src/public/credentials.controller.ts).
 */
test.describe("Setup: initial configuration", () => {
  test("a new user is redirected to Setup, saves the PAT and reaches the dashboard", async ({
    page,
  }) => {
    await page.goto("/");

    // Precondition shared by almost all other TS: without configuration
    // the system always redirects to /setup (Layout.tsx).
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { name: "Initial Setup" })).toBeVisible();

    // The submit button is disabled while the field is empty (UI-side guard).
    await expect(page.getByRole("button", { name: "Save and Start" })).toBeDisabled();

    await page.getByPlaceholder("ghp_xxxxxxxxxxxx...").fill("ghp_test_e2e_dummy_token_1234567890");
    await page.getByRole("button", { name: "Save and Start" }).click();

    // Save succeeded (real POST /credentials call) -> navigates to
    // home and the Layout stops redirecting to /setup.
    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
  });
});
