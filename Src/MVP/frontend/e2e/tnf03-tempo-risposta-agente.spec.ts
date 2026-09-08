import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  FILE_SORGENTE,
  registraEAccedi,
  salvaCredenziale,
  creaContesto,
  nuovoUtente,
  GITHUB_PAT,
  API,
  auth,
  type Utente,
} from './helpers';
import {
  OPERATION_LABELS,
  ROLE_OPERATIONS,
  type OperationCode,
} from '../src/types';

/**
 * TNF_03 (RQ.6) — il tempo di risposta di un agente non supera i cinque
 * minuti, misurato per ciascuno dei sette OperationCode.
 *
 * Stato atteso oggi: SALTATO. Ogni caso avvia un agente reale e quindi una
 * chiamata al modello: senza `E2E_LLM_ENABLED=1` e un PAT spendibile il test
 * si dichiara saltato, con lo stesso cancello di ts-agenti.spec.ts. È lo
 * stesso motivo per cui i trentasei casi di sistema che avviano un agente
 * non sono mai stati eseguiti.
 *
 * I sette codici non sono riscritti qui: sono le chiavi di
 * `OPERATION_LABELS`, che il tipo `Record<OperationCode, string>` obbliga a
 * restare esaustive. Un ottavo codice aggiunto al dominio comparirebbe da sé
 * fra i casi di questo file invece di restare non misurato.
 *
 * Che cosa viene cronometrato. RQ.6 parla del tempo «dalla ricezione della
 * richiesta all'emissione del Report», cioè del lavoro dell'agente. Due delle
 * sette operazioni — le Changelog — si sospendono per chiedere un dato
 * all'utente, e l'attesa di quella risposta non è tempo dell'agente: se la
 * si contasse, il tetto lo deciderebbe la velocità con cui l'operatore
 * digita. La misura primaria è quindi `Report.durationMs`, che il backend
 * accumula sui soli segmenti di tempo macchina (lo stesso campo che TI_09
 * verifica escludere le attese dell'utente). Il tempo a orologio viene
 * comunque riportato accanto, perché una differenza grande fra i due dice
 * dove è finito il tempo.
 *
 * Perché si pretende `COMPLETED`. Una task fallita risponde in fretta, e
 * misurare «quanto ci mette a fallire» soddisferebbe il tetto senza dire
 * nulla su RQ.6. Se al primo avvio una delle sette dovesse fallire per
 * ragioni di fixture — il repository di prova senza POLICY.md, o senza issue
 * chiuse per lo Sprint richiesto — il test lo segnala invece di nasconderlo
 * dietro un numero basso.
 */

const LLM = process.env.E2E_LLM_ENABLED === '1';

/** Tetto dichiarato da RQ.6, in millisecondi. */
const TETTO_MS = 5 * 60_000;

/** Sprint richiesto dalle operazioni Changelog quando si sospendono. */
const SPRINT = process.env.E2E_SPRINT_ID ?? 'Sprint 1';

const CODICI = Object.keys(OPERATION_LABELS) as OperationCode[];

/** Un ruolo che può avviare l'operazione indicata. */
function ruoloPer(codice: OperationCode): Utente['role'] {
  const ruolo = (
    Object.keys(ROLE_OPERATIONS) as Utente['role'][]
  ).find((r) => ROLE_OPERATIONS[r].includes(codice));
  if (!ruolo) {
    throw new Error(
      `Nessun ruolo può avviare ${codice}: ROLE_OPERATIONS e OperationCode sono disallineati.`,
    );
  }
  return ruolo;
}

interface Misura {
  stato: string;
  tempoMacchinaMs: number | null;
  tempoOrologioMs: number;
  sospensioni: string[];
}

test.describe('TNF_03 · Tempo di risposta dell\'agente', () => {
  test.skip(!GITHUB_PAT || !LLM, 'richiede E2E_GITHUB_PAT e E2E_LLM_ENABLED=1');

  /**
   * Avvia l'operazione, risponde alle eventuali sospensioni non appena
   * compaiono e restituisce le due misure.
   *
   * Le sospensioni vengono servite qui dentro perché l'oggetto della misura
   * è l'agente: farle attendere falserebbe il tempo a orologio senza toccare
   * quello macchina, e renderebbe i due numeri incomparabili.
   */
  async function misura(
    request: APIRequestContext,
    codice: OperationCode,
  ): Promise<Misura> {
    const { token } = await registraEAccedi(request, nuovoUtente(ruoloPer(codice)));
    await salvaCredenziale(request, token);
    const contextId = await creaContesto(request, token, {
      // Ambito ristretto a un file per contenere i tempi delle operazioni
      // che leggono codice; le Changelog leggono le Issue e non ne risentono.
      scopeType: 'FILES',
      paths: [FILE_SORGENTE],
    });

    const inizio = Date.now();
    const avvio = await request.post(`${API}/tasks`, {
      headers: auth(token),
      data: { contextId, operations: [codice] },
    });
    expect(avvio.ok()).toBeTruthy();
    const [taskId] = (await avvio.json()).taskIds as string[];

    const sospensioni: string[] = [];
    const scadenza = Date.now() + TETTO_MS + 60_000;

    while (Date.now() < scadenza) {
      const risposta = await request.get(`${API}/tasks/${taskId}`, {
        headers: auth(token),
      });
      expect(risposta.ok()).toBeTruthy();
      const task = await risposta.json();

      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status)) {
        const tempoOrologioMs = Date.now() - inizio;
        let tempoMacchinaMs: number | null = null;
        if (task.reportId) {
          const report = await request.get(`${API}/reports/${task.reportId}`, {
            headers: auth(token),
          });
          if (report.ok()) tempoMacchinaMs = (await report.json()).durationMs;
        }
        return {
          stato: task.status,
          tempoMacchinaMs,
          tempoOrologioMs,
          sospensioni,
        };
      }

      if (task.pendingInput) {
        const genere = task.pendingInput.kind as string;
        sospensioni.push(genere);
        await request.post(`${API}/tasks/${taskId}/input`, {
          headers: auth(token),
          data:
            genere === 'SPRINT_ID'
              ? { kind: genere, sprintId: SPRINT }
              : { kind: genere, action: 'PROCEED' },
        });
      }

      await new Promise((r) => setTimeout(r, 1_000));
    }

    throw new Error(
      `${codice}: nessun esito entro ${TETTO_MS + 60_000} ms — il tetto di RQ.6 è già superato.`,
    );
  }

  test('TNF_03 (RQ.6) — il dominio conta sette operazioni da misurare', () => {
    // Il presupposto dei casi qui sotto: se il dominio ne contenesse sei,
    // «per ciascuno dei sette» girerebbe su sei senza dirlo.
    expect(CODICI).toHaveLength(7);
  });

  for (const codice of CODICI) {
    test(`TNF_03 (RQ.6) — ${codice} emette il Report entro cinque minuti`, async ({
      request,
    }) => {
      // Un margine oltre il tetto, così che un superamento venga riportato
      // come misura fuori budget e non come scadenza del test.
      test.setTimeout(TETTO_MS + 3 * 60_000);

      const esito = await misura(request, codice);

      console.log(
        `TNF_03 ${codice}: tempo macchina ${esito.tempoMacchinaMs} ms, ` +
          `a orologio ${esito.tempoOrologioMs} ms, esito ${esito.stato}` +
          (esito.sospensioni.length
            ? `, sospensioni [${esito.sospensioni.join(', ')}]`
            : '') +
          ` (tetto ${TETTO_MS} ms)`,
      );

      expect(esito.stato).toBe('COMPLETED');
      // Un Report senza durata misurata rende il confronto col tetto una
      // formalità: va segnalato, non aggirato.
      expect(esito.tempoMacchinaMs).not.toBeNull();
      expect(esito.tempoMacchinaMs!).toBeGreaterThan(0);
      expect(esito.tempoMacchinaMs!).toBeLessThanOrEqual(TETTO_MS);
    });
  }
});
