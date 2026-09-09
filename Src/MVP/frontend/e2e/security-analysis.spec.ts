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
 * TA_09 (PdQ) — "Verificare che l'Agente Security esegua con successo la
 * scansione del codice sorgente alla ricerca di vulnerabilita' (OWASP Top 10)
 * e generi un report contenente le criticita' classificate per gravita'."
 * Copre anche i Test di Sistema collegati (RF.15, RF.25, RF.87, RF.88, RF.89,
 * RF.90/91, RF.53, RF.54, RF.60/61).
 *
 * End-to-end REALE: nessuna parte e' mockata. Il backend chiama davvero le API
 * di GitHub e l'agente Python chiama davvero l'LLM configurato. Repository
 * scelto: OWASP/NodeGoat, applicazione Node.js scritta dall'OWASP con
 * vulnerabilita' didattiche reali — cosi' il test verifica non solo che il
 * flusso funzioni, ma che l'agente trovi davvero qualcosa. Ambito ristretto ad
 * app/routes/ per restare sotto il limite di file e accorciare la chiamata
 * all'LLM.
 *
 * L'operazione e' riservata al ruolo Security Auditor.
 */
test.describe("Agente Security — scansione OWASP su repository reale", () => {
  test.skip(!GITHUB_PAT, SKIP_REASON);
  test.setTimeout(8 * 60_000);

  test("@agent avvia SECURITY_OWASP e visualizza il report con i finding", async ({ page }) => {
    await signedInWithCredentials(page, "Security Auditor");
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "master",
      scope: "Directory specifiche",
      paths: ["app/routes"],
    });

    await launchOperations(page, ["OWASP Top 10"]);
    const outcome = await waitForTerminalState(page);
    expect(outcome).toBe("Completato");

    await page.getByRole("link", { name: "Vedi report" }).click();
    await expect(page).toHaveURL(/\/reports\/[a-f0-9]{24}$/);
    await expect(page.getByRole("heading", { name: "Analisi Sicurezza OWASP" })).toBeVisible();

    // RF.53/RF.54: i finding sono classificati per gravita', e il filtro opera
    // su quella classificazione. La riga di filtri compare solo se il report
    // contiene blocchi con severita': la sua presenza e' quindi essa stessa
    // l'asserzione che su NodeGoat qualcosa e' stato trovato. Un report vuoto
    // qui e' un fallimento, non un repository pulito.
    await expect(page.getByText("Filtra per severità:")).toBeVisible();
    await expect(page.getByRole("button", { name: "Alto", exact: true })).toBeVisible();
    await expect(page.getByText(/Nessun elemento per il filtro selezionato/)).toHaveCount(0);

    // RF.87/RF.88: quando l'analisi statica e' attiva, il riepilogo Semgrep
    // precede i finding e dice se la lista e' completa. Se la fase e'
    // disattivata la sezione non c'e' affatto, ed e' corretto: si asserisce
    // solo la coerenza fra le due cose.
    const sast_summary = page.getByText("Analisi statica");
    if ((await sast_summary.count()) > 0) {
      await expect(sast_summary).toBeVisible();
      await expect(page.getByText("Finding totali")).toBeVisible();
    }

    // RF.60/61: il report e' esportabile. Il nome accessibile del pulsante e'
    // il suo testo ("Esporta PDF"), non l'attributo title ("Esporta in PDF"):
    // il title conta solo per un elemento che non ha contenuto testuale.
    await expect(page.getByRole("button", { name: "Esporta PDF" })).toBeEnabled();
  });
});
