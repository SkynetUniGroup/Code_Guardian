import request from "supertest";
import { type Mock, vi } from "vitest";
import { AgentRegistry, MAX_OPERATION_TIMEOUT_S } from "./../src/operations/agent-registry.service";
import { AmbienteE2E, attendiEsito, avviaAmbiente, utentePronto } from "./e2e-helpers";

/**
 * TI_14 (RQ.8) — la meta' lato backend della catena del rate limit.
 *
 * Complementare a TU_26, che verifica la sola funzione di mappatura, e alla
 * meta' Python in `agents/tests/test_ti14_rate_limit.py`, che copre gli
 * anelli a monte. Qui la domanda e': quando il servizio agenti risponde
 * `RATE_LIMITED`, l'utente vede davvero `error.code = LLM_RATE_LIMITED` sulla
 * propria task e sul proprio Report, passando per il codice vero?
 *
 * Per poterlo chiedere, questo test **non** sostituisce
 * AgentInvocationService — che e' proprio il componente che traduce — ma il
 * confine piu' in basso: la chiamata HTTP. Sostituire il servizio salterebbe
 * la mappatura insieme alla rete, e il test verificherebbe solo il proprio
 * doppio.
 *
 * Avvertenza sulla catena completa: oggi il servizio agenti non emette mai
 * la risposta che questo test gli mette in bocca. `execute_step` restituisce
 * `status: 'completed'` anche per un report FAILED, quindi il campo `error`
 * resta vuoto e un rate limit reale arriva qui come un completamento. Il
 * difetto e' documentato dall'xfail in test_ti14_rate_limit.py; queste
 * asserzioni descrivono cosa succede appena verra' corretto, e verificano fin
 * d'ora che la meta' backend sia pronta.
 */
describe("TI_14 (RQ.8) — propagazione dell'errore dell'agente fino alla task", () => {
  let ambiente: AmbienteE2E;
  let fetchOriginale: typeof global.fetch;
  let chiamateHttp: Mock;

  /** La risposta HTTP che il servizio agenti restituirebbe. */
  function rispostaAgente(corpo: unknown) {
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(corpo),
    };
  }

  /** Avvia una singola operazione e ne attende l'esito. */
  async function eseguiOperazione(
    utente: { token: string; contextId: string },
    operazione = "SECURITY_OWASP",
  ) {
    const avvio = await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${utente.token}`)
      .send({ contextId: utente.contextId, operations: [operazione] })
      .expect(202);

    return attendiEsito(ambiente.taskModel, avvio.body.taskIds[0] as string);
  }

  beforeAll(async () => {
    ambiente = await avviaAmbiente({ conAgenteReale: true });
    fetchOriginale = global.fetch;
  }, 60_000);

  afterAll(async () => {
    global.fetch = fetchOriginale;
    await ambiente?.chiudi();
  });

  beforeEach(() => {
    chiamateHttp = vi.fn();
    global.fetch = chiamateHttp as never;
  });

  it("un RATE_LIMITED dell'agente diventa error.code = LLM_RATE_LIMITED sulla task", async () => {
    const utente = await utentePronto(ambiente.server);
    chiamateHttp.mockResolvedValue(rispostaAgente({ status: "failed", error: "RATE_LIMITED" }));

    const conclusa = await eseguiOperazione(utente);

    expect(conclusa.status).toBe("FAILED");
    expect(conclusa.error?.code).toBe("LLM_RATE_LIMITED");
  }, 120_000);

  it("lo stesso codice arriva al Report e alla lettura via API", async () => {
    // Il campo che l'interfaccia legge davvero: un errore corretto sulla task
    // e assente dal Report lascerebbe l'utente senza spiegazione nella pagina
    // in cui la cerca.
    const utente = await utentePronto(ambiente.server);
    chiamateHttp.mockResolvedValue(rispostaAgente({ status: "failed", error: "RATE_LIMITED" }));

    const conclusa = await eseguiOperazione(utente);

    const task = await request(ambiente.server)
      .get(`/api/v1/tasks/${conclusa.id}`)
      .set("Authorization", `Bearer ${utente.token}`)
      .expect(200);
    expect(task.body.error.code).toBe("LLM_RATE_LIMITED");

    const report = await request(ambiente.server)
      .get(`/api/v1/reports/${conclusa.reportId}`)
      .set("Authorization", `Bearer ${utente.token}`)
      .expect(200);
    expect(report.body.status).toBe("FAILED");
    expect(report.body.error.kind).toBe("LLM_RATE_LIMITED");
  }, 120_000);

  it.each([
    ["RATE_LIMITED", "LLM_RATE_LIMITED"],
    ["TIMEOUT", "TIMEOUT"],
    ["CONTEXT_TOO_LARGE", "CONTEXT_TOO_LARGE"],
    ["QUALCOSA_DI_NUOVO", "UPSTREAM"],
  ])(
    "l'agente risponde %s e la task riporta %s",
    async (dallAgente, atteso) => {
      // Il percorso completo per i casi che distinguono la mappatura: il
      // rinominato, due passanti e uno sconosciuto che deve ricadere su
      // UPSTREAM invece di arrivare all'utente come codice inventato.
      const utente = await utentePronto(ambiente.server);
      chiamateHttp.mockResolvedValue(rispostaAgente({ status: "failed", error: dallAgente }));

      const conclusa = await eseguiOperazione(utente);

      expect(conclusa.error?.code).toBe(atteso);
    },
    120_000,
  );

  it("ogni invocazione porta una scadenza: nessuna attesa senza limite", async () => {
    // "Senza attese indefinite" e' una proprieta' della richiesta, non
    // dell'esito: si verifica guardando che la chiamata parta con una
    // scadenza, non aspettando 185 secondi che scatti.
    const scadenze = vi.spyOn(AbortSignal, "timeout");
    const utente = await utentePronto(ambiente.server);
    chiamateHttp.mockResolvedValue(rispostaAgente({ status: "failed", error: "RATE_LIMITED" }));

    await eseguiOperazione(utente);

    const [, opzioni] = chiamateHttp.mock.calls[0] as [string, { signal?: AbortSignal }];
    expect(opzioni.signal).toBeInstanceOf(AbortSignal);

    // La scadenza e' quella del registro piu' il margine di rete, non un
    // numero a caso, e resta sotto il tetto rigido di RQ.6.
    const budget = new AgentRegistry().getTimeoutS("SECURITY_OWASP");
    expect(scadenze).toHaveBeenCalledWith((budget + 5) * 1000);
    expect(budget).toBeLessThanOrEqual(MAX_OPERATION_TIMEOUT_S);
    scadenze.mockRestore();
  }, 120_000);

  it("scaduta l'attesa, la task fallisce invece di restare RUNNING per sempre", async () => {
    // Il caso peggiore: l'agente non risponde affatto. La task deve
    // raggiungere uno stato terminale, ed e' UPSTREAM e non TIMEOUT — il
    // secondo e' riservato al modello che dichiara di essere andato in
    // timeout, qui non sappiamo nemmeno se ci ha provato.
    const utente = await utentePronto(ambiente.server);
    const scaduta = new Error("The operation was aborted due to timeout");
    scaduta.name = "TimeoutError";
    chiamateHttp.mockRejectedValue(scaduta);

    const conclusa = await eseguiOperazione(utente);

    expect(conclusa.status).toBe("FAILED");
    expect(conclusa.error?.code).toBe("UPSTREAM");
    expect(conclusa.error?.message).toContain("timed out");
  }, 120_000);

  it("un agente irraggiungibile chiude comunque la task, e in fretta", async () => {
    // La rete che cade: nessun 429, nessuna risposta, solo un errore di
    // connessione. Anche qui la task deve chiudersi, e il tempo misurato sta
    // ben sotto il budget dell'operazione — cioe' il backend non sta
    // aspettando la scadenza per accorgersene.
    const utente = await utentePronto(ambiente.server);
    chiamateHttp.mockRejectedValue(new Error("ECONNREFUSED"));

    const inizio = Date.now();
    const conclusa = await eseguiOperazione(utente);
    const trascorso = Date.now() - inizio;

    expect(conclusa.status).toBe("FAILED");
    expect(conclusa.error?.code).toBe("UPSTREAM");
    expect(trascorso).toBeLessThan(30_000);
  }, 120_000);

  it("un 5xx del servizio agenti non diventa un successo silenzioso", async () => {
    const utente = await utentePronto(ambiente.server);
    chiamateHttp.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    });

    const conclusa = await eseguiOperazione(utente);

    expect(conclusa.status).toBe("FAILED");
    expect(conclusa.error?.code).toBe("UPSTREAM");
    expect(conclusa.error?.message).toContain("503");
  }, 120_000);
});
