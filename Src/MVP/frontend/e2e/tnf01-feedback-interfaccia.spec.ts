import { test, expect, type Page } from '@playwright/test';
import {
  FILE_SORGENTE,
  patSpendibile,
  vaiA,
  registraEAccedi,
  accediDalModulo,
  salvaCredenziale,
  creaContesto,
  nuovoUtente,
  REPO,
  API,
  auth,
  type Utente,
} from './helpers';

/**
 * TNF_01 (RQ.10) — il feedback visivo dell'interfaccia entro due secondi.
 *
 * Le tre interazioni sono quelle che la voce nomina: selezione del
 * repository, avvio delle operazioni, apertura di un Report. Sono gli stessi
 * percorsi che TS_16, TS_44 e TS_53 già esercitano; qui non si verifica che
 * funzionino — quello è già coperto — ma quanto ci mettono a rispondere.
 *
 * Che cosa si cronometra, e perché non altro. RQ.10 parla del tempo fra
 * l'azione dell'utente e il *feedback visivo*, non del completamento del
 * lavoro che l'azione mette in moto. Avviare due operazioni fa partire due
 * task che dureranno minuti: il riscontro che l'utente aspetta è vedersi
 * portato nella dashboard con le operazioni elencate, e la misura si ferma
 * lì. Cronometrare fino a «Completato» misurerebbe l'agente e il modello,
 * che RQ.6 governa separatamente, e questo test fallirebbe sempre pur
 * essendo l'interfaccia perfettamente reattiva.
 *
 * Il cronometro parte dopo che l'elemento è pronto a ricevere il clic:
 * `click()` di Playwright attende da sé che il bersaglio sia stabile e
 * abilitato, e quell'attesa non è tempo che l'utente vede — lui il pulsante
 * ce l'ha già davanti. Includerla misurerebbe il caricamento della pagina
 * precedente al posto della reattività dell'interazione.
 *
 * Tre misure per interazione e giudizio sulla mediana e sul massimo: una
 * misura sola su un browser reale è rumorosa (prima compilazione dei moduli
 * di Vite, garbage collector, macchina occupata) e renderebbe il test
 * intermittente senza che nulla sia peggiorato.
 */

/** Tetto dichiarato da RQ.10, in millisecondi. */
const TETTO_MS = 2_000;

/** Misure per ciascuna interazione. */
const RIPETIZIONI = 3;

/**
 * Margine entro cui si attende il riscontro prima di dichiarare l'attesa
 * fallita. Volutamente più largo del tetto: se l'interfaccia impiegasse
 * cinque secondi, il test deve poter riportare «cinque secondi» invece di
 * scadere e lasciare come unica informazione che qualcosa non è comparso.
 */
const ATTESA_MAX_MS = 20_000;

function mediana(valori: number[]): number {
  const ordinati = [...valori].sort((a, b) => a - b);
  const meta = Math.floor(ordinati.length / 2);
  return ordinati.length % 2
    ? ordinati[meta]
    : (ordinati[meta - 1] + ordinati[meta]) / 2;
}

/** Stampa il campione: il numero misurato è il risultato del test. */
function riporta(interazione: string, misure: number[]): void {
  const ordinati = [...misure].sort((a, b) => a - b);
  console.log(
    `TNF_01 ${interazione}: mediana ${mediana(misure)} ms, ` +
      `massimo ${ordinati[ordinati.length - 1]} ms ` +
      `(${misure.length} misure, tetto ${TETTO_MS} ms) — [${ordinati.join(', ')}]`,
  );
}

/** Cronometra dall'azione al primo riscontro visivo. */
async function cronometra(
  azione: () => Promise<void>,
  riscontro: () => Promise<void>,
): Promise<number> {
  const inizio = Date.now();
  await azione();
  await riscontro();
  return Date.now() - inizio;
}

test.describe('TNF_01 · Feedback dell\'interfaccia entro due secondi', () => {
  test.beforeAll(async ({ request }) => {
    // L'elenco dei repository arriva da GitHub: senza un PAT spendibile la
    // prima interazione non è nemmeno raggiungibile.
    test.skip(
      !(await patSpendibile(request)),
      'richiede un E2E_GITHUB_PAT con lo scope "repo"',
    );
  });

  /**
   * Utente autenticato con credenziale salvata, fermo sulla pagina
   * Repository.
   *
   * Il ruolo conta: la pagina di avvio mostra solo le operazioni permesse a
   * chi la guarda, quindi il test sull'avvio ha bisogno di un
   * SECURITY_AUDITOR per trovarsi davanti la scansione OWASP.
   */
  async function suRepository(
    page: Page,
    request: any,
    ruolo: Utente['role'] = 'DEVELOPER',
  ): Promise<void> {
    const { utente, token } = await registraEAccedi(request, nuovoUtente(ruolo));
    await salvaCredenziale(request, token);
    await accediDalModulo(page, utente);
    await vaiA(page, 'Repository');
    await expect(page.getByLabel('Repository')).toBeVisible();
  }

  test('TNF_01 (RQ.10) — la selezione del repository dà riscontro entro due secondi', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const misure: number[] = [];

    for (let i = 0; i < RIPETIZIONI; i += 1) {
      await suRepository(page, request);

      // Il riscontro alla scelta del repository è il campo del riferimento
      // che si popola da solo col branch di default: è il primo segno che
      // l'interfaccia ha recepito la selezione e interrogato il backend.
      const riferimento = page.getByLabel('Branch o Commit SHA');
      await expect(riferimento).toBeVisible();

      misure.push(
        await cronometra(
          () =>
            page
              .getByLabel('Repository')
              .selectOption(`${REPO.owner}/${REPO.name}`),
          () =>
            expect(riferimento).toHaveValue(REPO.branch, {
              timeout: ATTESA_MAX_MS,
            }),
        ),
      );
    }

    riporta('selezione del repository', misure);
    expect(mediana(misure)).toBeLessThanOrEqual(TETTO_MS);
    expect(Math.max(...misure)).toBeLessThanOrEqual(TETTO_MS);
  });

  test('TNF_01 (RQ.10) — l\'avvio delle operazioni dà riscontro entro due secondi', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const misure: number[] = [];

    for (let i = 0; i < RIPETIZIONI; i += 1) {
      await suRepository(page, request, 'SECURITY_AUDITOR');
      await page.getByLabel('Repository').selectOption(`${REPO.owner}/${REPO.name}`);
      await page
        .getByRole('button', { name: /Salva contesto e vai ad Avvia/ })
        .click();
      await expect(page).toHaveURL(/\/run$/);

      await page.getByRole('button', { name: /Analisi Sicurezza OWASP/ }).click();
      // Con una sola operazione selezionata il pulsante non porta il numero:
      // e' 'Avvia operazione', non 'Avvia 1 operazioni'.
      const avvia = page.getByRole('button', { name: 'Avvia operazione' });
      await expect(avvia).toBeEnabled();

      // Il riscontro è la dashboard di monitoraggio con l'operazione
      // elencata. Non si attende l'esito della task: quella è RQ.6.
      misure.push(
        await cronometra(
          () => avvia.click(),
          async () => {
            await expect(page).toHaveURL(/\/tasks$/, { timeout: ATTESA_MAX_MS });
            await expect(
              page.getByText('Analisi Sicurezza OWASP').first(),
            ).toBeVisible({ timeout: ATTESA_MAX_MS });
          },
        ),
      );
    }

    riporta('avvio delle operazioni', misure);
    expect(mediana(misure)).toBeLessThanOrEqual(TETTO_MS);
    expect(Math.max(...misure)).toBeLessThanOrEqual(TETTO_MS);
  });

  test('TNF_01 (RQ.10) — l\'apertura di un Report dà riscontro entro due secondi', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);

    /**
     * Prepara un utente che ha già un Report da aprire.
     *
     * La task viene avviata e attesa dalle API, non dall'interfaccia:
     * l'attesa che la task finisca non fa parte di ciò che si misura, e
     * passare dalle API la tiene fuori dal cronometro in modo evidente.
     * L'esito non conta: un Report fallito si apre come uno riuscito, ed è
     * la stessa pagina.
     */
    async function conReportPronto(): Promise<Utente> {
      const { utente, token } = await registraEAccedi(
        request,
        nuovoUtente('SECURITY_AUDITOR'),
      );
      await salvaCredenziale(request, token);
      const contextId = await creaContesto(request, token, {
        scopeType: 'FILES',
        paths: [FILE_SORGENTE],
      });
      await request.post(`${API}/tasks`, {
        headers: auth(token),
        data: { contextId, operations: ['SECURITY_OWASP'] },
      });

      const scadenza = Date.now() + 240_000;
      while (Date.now() < scadenza) {
        const elenco = await request.get(`${API}/reports`, {
          headers: auth(token),
        });
        if (elenco.ok() && (await elenco.json()).length > 0) return utente;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      throw new Error('Nessun Report disponibile: la task non si è conclusa');
    }

    const misure: number[] = [];

    for (let i = 0; i < RIPETIZIONI; i += 1) {
      const utente = await conReportPronto();
      await accediDalModulo(page, utente);
      await vaiA(page, 'Report');

      const collegamento = page
        .getByRole('link', { name: /Visualizza/ })
        .first();
      await expect(collegamento).toBeVisible();

      // Il riscontro è il titolo del Report a schermo, non il solo cambio di
      // URL: l'utente vede una pagina, non un indirizzo.
      misure.push(
        await cronometra(
          () => collegamento.click(),
          () =>
            expect(page.getByRole('heading', { level: 1 })).toBeVisible({
              timeout: ATTESA_MAX_MS,
            }),
        ),
      );
    }

    riporta('apertura di un Report', misure);
    expect(mediana(misure)).toBeLessThanOrEqual(TETTO_MS);
    expect(Math.max(...misure)).toBeLessThanOrEqual(TETTO_MS);
  });
});
