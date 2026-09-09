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
 * TS/TA per SECURITY_POLICY (RF.92, RF.93, RF.70). End-to-end reale.
 *
 * Caso positivo: `IlGranz/codeguardian-e2e-fixture`, repository di prova
 * pubblico creato apposta, con un POLICY.md e un file JS con violazioni
 * intenzionali (segreto in chiaro, `eval()`, SQL injection).
 *
 * Due tentativi precedenti prima di arrivare a quella scelta, entrambi
 * scoperte reali e conservate qui perche' spiegano il vincolo:
 * 1. `sigstore/sigstore` (Go) — bocciato dalla validazione del linguaggio
 *    (RV.7 vuole TypeScript, JavaScript o Python).
 * 2. `keldaanCommunity/pokemonAutoChess` (TypeScript, ma enorme) — ha
 *    rivelato che l'albero file di GitHub viene troncato dall'API oltre i
 *    ~64000 nodi e il backend non se ne accorge, producendo un falso
 *    "POLICY.md non trovato" per un file che esiste.
 *
 * Caso negativo (RF.70/UC27.5): OWASP/NodeGoat non ha alcun POLICY.md, e
 * l'assenza della risorsa deve diventare un errore esplicito, non un crash
 * silenzioso ne' un report vuoto dichiarato riuscito.
 */
test.describe("Agente Security — verifica POLICY.md", () => {
  test.skip(!GITHUB_PAT, SKIP_REASON);
  test.setTimeout(8 * 60_000);

  test("@agent RF.92/93 — POLICY.md presente: la scansione completa e produce un report", async ({
    page,
  }) => {
    await signedInWithCredentials(page, "Security Auditor");
    await submitContext(page, {
      repo: "IlGranz/codeguardian-e2e-fixture",
      branch: "main",
      scope: "Repository completo",
    });

    await launchOperations(page, ["Policy-as-code"]);
    const outcome = await waitForTerminalState(page);
    expect(outcome).toBe("Completato");

    await page.getByRole("link", { name: "Vedi report" }).click();
    await expect(page.getByRole("heading", { name: "Verifica Policy" })).toBeVisible();
    await expect(page.getByText(/Nessun elemento per il filtro selezionato/)).toHaveCount(0);
  });

  test("@agent RF.70/UC27.5 — POLICY.md assente: fallisce con un errore esplicito", async ({
    page,
  }) => {
    await signedInWithCredentials(page, "Security Auditor");
    await submitContext(page, {
      repo: "OWASP/NodeGoat",
      branch: "master",
      scope: "Directory specifiche",
      paths: ["app/routes"],
    });

    await launchOperations(page, ["Policy-as-code"]);
    const outcome = await waitForTerminalState(page);
    expect(outcome).toBe("Fallito");

    // Il punto del caso: il fallimento e' *classificato*, non generico. La
    // scheda del Task mostra il codice dell'errore accanto al messaggio.
    await expect(page.getByText(/CONTEXT_RESOURCE_MISSING|POLICY/i).first()).toBeVisible();
  });
});
