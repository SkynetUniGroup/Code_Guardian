import { expect, test } from "@playwright/test";
import { registerAndLogin } from "./helpers";

/**
 * TS_79 — TS_81 (PdQ) — RF.79, RF.80, RF.81: gestione del template README.
 *
 * Il template e' una risorsa personale dell'utente: non dipende dal repository
 * selezionato e non passa da GitHub, quindi questi casi girano senza
 * E2E_GITHUB_PAT. La pagina e' riservata al ruolo Sviluppatore.
 */

/** Un file Markdown costruito al volo, senza appoggiarsi a file su disco. */
function templateMarkdown(nome: string, contenuto: string) {
  return {
    name: nome,
    mimeType: "text/markdown",
    buffer: Buffer.from(contenuto, "utf8"),
  };
}

test.describe("Template README", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, "Developer");
    await page
      .getByRole("complementary", { name: "Navigazione principale" })
      .getByRole("link", { name: "Template" })
      .click();
    await expect(page.getByRole("heading", { name: "Template README" })).toBeVisible();
  });

  test("TS_79 (RF.79) — si carica e si salva un template personalizzato", async ({ page }) => {
    // Lo stato di partenza e' esplicito, non vuoto: l'utente deve capire che
    // sta usando il modello di default e non che la pagina non ha caricato.
    await expect(
      page.getByText("Nessun template personalizzato: è in uso il modello di default."),
    ).toBeVisible();

    await page
      .getByLabel("Carica un template (.md)")
      .setInputFiles(templateMarkdown("mio-template.md", "# Titolo\n\n## Installazione\n"));

    await expect(page.getByRole("status")).toContainText("Template salvato.");
    // Salvato vuol dire che resta: il nome e il contenuto tornano a schermo.
    await expect(page.getByText("mio-template.md")).toBeVisible();
    await expect(page.getByText("## Installazione")).toBeVisible();
  });

  test("TS_79 (RF.79) — il template salvato sopravvive a un rientro nella pagina", async ({
    page,
  }) => {
    await page
      .getByLabel("Carica un template (.md)")
      .setInputFiles(templateMarkdown("persistente.md", "# Persistente\n"));
    await expect(page.getByRole("status")).toContainText("Template salvato.");

    // Si esce e si rientra: se fosse rimasto solo nello stato del componente,
    // qui non ci sarebbe piu'.
    const barra = page.getByRole("complementary", { name: "Navigazione principale" });
    await barra.getByRole("link", { name: "Report" }).click();
    await barra.getByRole("link", { name: "Template" }).click();

    await expect(page.getByText("persistente.md")).toBeVisible();
  });

  test("TS_80 (RF.80) — un file non valido viene rifiutato con un messaggio", async ({ page }) => {
    // Un binario travestito da .md: l'estensione da sola non basta, ed e'
    // esattamente il caso che readme-template.validation.ts intercetta
    // cercando i caratteri di controllo tipici di un file non testuale.
    const binario = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    await page.getByLabel("Carica un template (.md)").setInputFiles({
      name: "finto.md",
      mimeType: "text/markdown",
      buffer: binario,
    });

    await expect(page.getByRole("alert")).toBeVisible();
    // E il rifiuto non deve lasciare a meta': resta il modello di default.
    await expect(
      page.getByText("Nessun template personalizzato: è in uso il modello di default."),
    ).toBeVisible();
  });

  test("TS_81 (RF.81) — si rimuove il template e si torna al modello di default", async ({
    page,
  }) => {
    await page
      .getByLabel("Carica un template (.md)")
      .setInputFiles(templateMarkdown("da-rimuovere.md", "# Da rimuovere\n"));
    await expect(page.getByText("da-rimuovere.md")).toBeVisible();

    await page.getByRole("button", { name: "Rimuovi template" }).click();

    await expect(page.getByRole("status")).toContainText("Template rimosso");
    await expect(
      page.getByText("Nessun template personalizzato: è in uso il modello di default."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Rimuovi template" })).toHaveCount(0);
  });
});
