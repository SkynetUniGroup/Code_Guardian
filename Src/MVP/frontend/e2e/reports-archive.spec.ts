import { expect, type Page, test } from "@playwright/test";
import {
  GITHUB_PAT,
  launchOperations,
  registerAndLogin,
  SKIP_REASON,
  signedInWithCredentials,
  submitContext,
  vaiA,
  waitForTerminalState,
} from "./helpers";

/**
 * TS_49 — TS_52, TS_57, TS_64, TS_74 (PdQ) — RF.49..RF.52, RF.57, RF.64,
 * RF.74:
 * archivio storico dei Report, intestazione del singolo Report ed esportazione.
 *
 * TS_49 verifica l'archivio quando e' vuoto, e per farlo basta un account
 * appena creato: gira sempre. Tutti gli altri hanno bisogno di un Report che
 * esista davvero, e un Report nasce solo da un'analisi completata — quindi da
 * GitHub e dall'LLM. Quelli si saltano da soli senza E2E_GITHUB_PAT e sono
 * marcati @agent, cosi' girano su Chromium soltanto: ripetere un'analisi vera su
 * tre browser costerebbe tre chiamate al modello per verificare qualcosa che col
 * motore di rendering non c'entra.
 */

const REPO = "OWASP/NodeGoat";
const BRANCH = "master";

/**
 * I nomi delle operazioni come l'interfaccia li mostra: sono le etichette
 * italiane di OPERATION_LABELS, non il displayName inglese che GET /operations
 * restituisce. Cercare il nome inglese non troverebbe nessun pulsante.
 *
 * Per fabbricare un Report si usa DOCS_README e non la scansione OWASP: a questi
 * casi serve *un* report qualunque — quello che verificano e' l'archivio,
 * l'intestazione e l'esportazione, non cosa l'agente ha trovato — e la
 * documentazione del README si chiude in una decina di secondi contro i minuti
 * di una scansione completa. Meno tempo, meno token, stessa proprieta'.
 */
const OPERAZIONE_REPORT = "Documentazione README";
const OPERAZIONE_CHANGELOG = "Changelog Tecnico";

/**
 * Apre il dettaglio del primo report dell'archivio.
 *
 * Si clicca la riga, non un collegamento dentro di essa: la tabella non ne
 * contiene. L'unico elemento interattivo della riga e' il pulsante "Elimina", e
 * la navigazione al dettaglio e' un onClick sulla riga stessa.
 */
async function apriPrimoReport(page: Page): Promise<void> {
  await page.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f]{8,}/i, { timeout: 30_000 });
}

/** Porta a termine un'analisi e apre il Report che ne e' uscito. */
async function reportCompletato(page: Page): Promise<void> {
  await signedInWithCredentials(page);
  await submitContext(page, { repo: REPO, branch: BRANCH, scope: "Repository completo" });
  await launchOperations(page, [OPERAZIONE_REPORT]);
  await waitForTerminalState(page);

  await vaiA(page, "Report");
  await apriPrimoReport(page);
}

test.describe("Archivio dei Report", () => {
  test("TS_49 (RF.49) — l'archivio e' raggiungibile e dichiara quando e' vuoto", async ({
    page,
  }) => {
    // Raggiungibile senza credenziale GitHub di proposito: leggere il lavoro
    // gia' svolto non richiede GitHub, e chiudere l'archivio lo nasconderebbe.
    await registerAndLogin(page);
    await vaiA(page, "Report");

    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole("heading", { name: "Storico Report" })).toBeVisible();
    // Un archivio vuoto lo dice, e offre la via d'uscita: avviare un'analisi.
    await expect(page.getByText("Nessun report disponibile.")).toBeVisible();
  });

  test("TS_50 / TS_51 / TS_52 (RF.50, RF.51, RF.52) — ogni voce dell'archivio porta identificativo, titolo e tempi @agent", async ({
    page,
  }) => {
    test.skip(!GITHUB_PAT, SKIP_REASON);
    test.setTimeout(8 * 60_000);

    await signedInWithCredentials(page);
    await submitContext(page, { repo: REPO, branch: BRANCH, scope: "Repository completo" });
    await launchOperations(page, [OPERAZIONE_REPORT]);
    await waitForTerminalState(page);

    await vaiA(page, "Report");

    const voce = page.getByRole("row").nth(1);
    // RF.51 — il titolo descrittivo, nel formato deterministico che il backend
    // compone: "<operazione> — owner/repo@branch".
    await expect(voce).toContainText(`${REPO}@${BRANCH}`);
    // RF.52 — data e durata di completamento. Niente \b dopo la "s": nel testo
    // concatenato della riga la durata e' seguita subito dall'etichetta del
    // pulsante ("7.2sElimina"), quindi il confine di parola non c'e'.
    await expect(voce).toContainText(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}:\d{2}/);
    await expect(voce).toContainText(/\d+(?:[.,]\d+)?\s*s/);
    // RF.50 — l'identificativo univoco. Non compare come testo nella riga ne'
    // come href, perche' la navigazione al dettaglio e' un onClick: si verifica
    // dove porta, cioe' /reports/<id>. E' anche il modo in cui l'utente lo usa.
    await apriPrimoReport(page);
  });

  test("TS_57 (RF.57) — l'intestazione del Report riporta il tempo impiegato dall'agente @agent", async ({
    page,
  }) => {
    test.skip(!GITHUB_PAT, SKIP_REASON);
    test.setTimeout(8 * 60_000);

    await reportCompletato(page);

    const contenuto = page.getByRole("main");
    // Il tempo di esecuzione, in secondi, accanto a operazione, stato e data.
    await expect(contenuto).toContainText(/\d+(?:[.,]\d+)?s/);
    await expect(contenuto).toContainText("Completato");
  });

  test("TS_64 (RF.64) — le operazioni che richiedono conferma espongono i comandi di validazione @agent", async ({
    page,
  }) => {
    test.skip(!GITHUB_PAT, SKIP_REASON);
    test.setTimeout(8 * 60_000);

    // Il changelog tecnico e' l'operazione dell'MVP che si ferma per chiedere
    // conferma: e' li' che il modulo interattivo deve comparire.
    await signedInWithCredentials(page);
    await submitContext(page, { repo: REPO, branch: BRANCH, scope: "Repository completo" });
    await launchOperations(page, [OPERAZIONE_CHANGELOG]);

    // Il comando si chiama "Inserisci Sprint ID": e' cosi' che il modulo
    // interattivo si presenta quando il changelog si ferma per chiedere il
    // riferimento dello sprint.
    await expect(page.getByRole("button", { name: /Sprint ID/i }).first()).toBeVisible({
      timeout: 6 * 60_000,
    });
  });

  test("TS_74 (RF.74) — un'anomalia durante l'esportazione annulla il download e lo dice @agent", async ({
    page,
  }) => {
    test.skip(!GITHUB_PAT, SKIP_REASON);
    test.setTimeout(8 * 60_000);

    await reportCompletato(page);

    // L'anomalia si induce sulla rete invece di aspettarla: un 500 dall'export
    // e' esattamente il caso che RF.74 descrive, e provocarlo e' l'unico modo di
    // verificarlo in modo ripetibile.
    await page.route("**/reports/*/export*", (route) =>
      route.fulfill({ status: 500, body: "errore indotto dal test" }),
    );

    await page.getByRole("button", { name: /Esporta PDF/ }).click();

    await expect(page.getByText(/Errore durante il download del PDF/)).toBeVisible();
    // Il Report resta a schermo: un'esportazione fallita non deve far perdere
    // all'utente quello che stava guardando.
    await expect(page.getByRole("heading").first()).toBeVisible();
  });
});
