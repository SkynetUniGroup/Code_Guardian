import request from "supertest";
import { TaskDocument } from "./../src/tasks/schemas/task.schema";
import { AmbienteE2E, attendiChe, attendiEsito, avviaAmbiente, utentePronto } from "./e2e-helpers";

/**
 * TI_09 (RF.94, 98, 100, 103, 104, 57) e TI_10 (RF.99, 102, 105) — le tre
 * sospensioni di CHANGELOG_BUSINESS, la ripresa e l'annullamento.
 *
 * Copertura PARZIALE, e il confine e' dichiarato: il Piano di Qualifica
 * descrive TI_09 come la verifica del meccanismo `interrupt` /
 * `Command(resume=...)` di LangGraph col checkpointer MongoDB. Quel
 * meccanismo vive nel servizio agenti Python, e qui il servizio agenti e' un
 * doppio. Cio' che questi test verificano e' l'altra meta', quella che vive
 * nel backend e che nessun test di unita' vede intera: che la task
 * attraversi le tre sospensioni nell'ordine giusto, che ogni risposta
 * dell'utente la rimetta in coda, che l'annullamento sia possibile in
 * ciascuno dei tre punti, e che il tempo registrato sul Report sia solo
 * tempo macchina.
 *
 * La prima sospensione, SPRINT_ID, e' particolare: TaskProcessor la solleva
 * da solo, prima di parlare con l'agente (startOrPause), perche' senza
 * sprintId l'agente non avrebbe di che partire. Le altre due arrivano
 * dall'agente. E' anche il motivo per cui il doppio viene interrogato due
 * volte e non tre.
 *
 * Per misurare RF.57 il doppio dell'agente impiega un tempo noto a ogni
 * chiamata, e il test lascia passare fra una risposta e l'altra molto piu'
 * tempo di quello: se `durationMs` contasse le attese dell'utente, la
 * differenza sarebbe evidente invece che sottile.
 */
describe("TI_09 / TI_10 — sospensione, ripresa e annullamento di CHANGELOG_BUSINESS", () => {
  let ambiente: AmbienteE2E;

  /** Tempo macchina simulato di una singola chiamata all'agente. */
  const MS_PER_CHIAMATA = 250;
  /** Attesa dell'utente fra una sospensione e la sua risposta. */
  const MS_ATTESA_UTENTE = 900;

  const SOSPENSIONE_2 = {
    kind: "INCOMPLETE_TASKS" as const,
    taskIds: ["CG-101", "CG-102"],
  };
  const SOSPENSIONE_3 = {
    kind: "BUSINESS_CONFIRMATION" as const,
    technicalReportId: "000000000000000000000001",
  };

  function attendi(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Una risposta dell'agente che costa un tempo macchina noto. */
  async function dopoIlTempoMacchina<T>(risultato: T): Promise<T> {
    await attendi(MS_PER_CHIAMATA);
    return risultato;
  }

  /** Avvia una CHANGELOG_BUSINESS e restituisce l'id della task. */
  async function avviaChangelogBusiness(utente: {
    token: string;
    contextId: string;
  }): Promise<string> {
    const avvio = await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${utente.token}`)
      .send({
        contextId: utente.contextId,
        operations: ["CHANGELOG_BUSINESS"],
      })
      .expect(202);
    return avvio.body.taskIds[0] as string;
  }

  /** Attende che la task si fermi sulla sospensione indicata. */
  async function attendiSospensione(taskId: string, kind: string): Promise<TaskDocument> {
    await attendiChe(async () => {
      const task = await ambiente.taskModel.findById(taskId);
      return task?.pendingInput?.kind === kind;
    }, `la task ${taskId} si ferma su ${kind}`);
    return (await ambiente.taskModel.findById(taskId))!;
  }

  /** Risponde a una sospensione, dopo aver fatto passare del tempo. */
  async function rispondi(
    token: string,
    taskId: string,
    corpo: Record<string, unknown>,
    atteso = 204,
  ) {
    await attendi(MS_ATTESA_UTENTE);
    return request(ambiente.server)
      .post(`/api/v1/tasks/${taskId}/input`)
      .set("Authorization", `Bearer ${token}`)
      .send(corpo)
      .expect(atteso);
  }

  /**
   * Configura il doppio per il percorso nominale: due sospensioni
   * dall'agente, poi il completamento.
   */
  function agenteConTreSospensioni(): void {
    ambiente.agente.invoke.mockImplementation(() =>
      dopoIlTempoMacchina({
        status: "INTERRUPTED",
        pendingInput: SOSPENSIONE_2,
      }),
    );
    let ripreseFatte = 0;
    ambiente.agente.resume.mockImplementation(() => {
      ripreseFatte += 1;
      return dopoIlTempoMacchina(
        ripreseFatte === 1
          ? { status: "INTERRUPTED", pendingInput: SOSPENSIONE_3 }
          : {
              status: "COMPLETED",
              payload: {
                body: [
                  {
                    kind: "TEXT",
                    markdown: "Changelog di business dello sprint.",
                  },
                ],
                summary: "Changelog di business pronto.",
                tokensConsumed: 480,
              },
            },
      );
    });
  }

  beforeAll(async () => {
    ambiente = await avviaAmbiente();
  }, 60_000);

  afterAll(async () => {
    await ambiente?.chiudi();
  });

  beforeEach(() => {
    ambiente.agente.invoke.mockReset();
    ambiente.agente.resume.mockReset();
    ambiente.github.listIssues.mockClear();
    ambiente.github.getIssueDetail.mockClear();
  });

  it("TI_09 — attraversa le tre sospensioni nell'ordine previsto e arriva a COMPLETED", async () => {
    const utente = await utentePronto(ambiente.server, "PROJECT_MANAGER");
    agenteConTreSospensioni();

    const taskId = await avviaChangelogBusiness(utente);

    // Prima sospensione: SPRINT_ID, sollevata dal backend prima di
    // interpellare l'agente.
    const primaFermata = await attendiSospensione(taskId, "SPRINT_ID");
    expect(primaFermata.status).toBe("RUNNING");
    expect(ambiente.agente.invoke).not.toHaveBeenCalled();

    await rispondi(utente.token, taskId, {
      kind: "SPRINT_ID",
      sprintId: "SPRINT-42",
    });

    // Seconda sospensione: INCOMPLETE_TASKS, dall'agente.
    const secondaFermata = await attendiSospensione(taskId, "INCOMPLETE_TASKS");
    expect(secondaFermata.pendingInput).toEqual(SOSPENSIONE_2);
    expect(ambiente.agente.invoke).toHaveBeenCalledTimes(1);

    await rispondi(utente.token, taskId, {
      kind: "INCOMPLETE_TASKS",
      action: "PROCEED",
    });

    // Terza sospensione: BUSINESS_CONFIRMATION.
    const terzaFermata = await attendiSospensione(taskId, "BUSINESS_CONFIRMATION");
    expect(terzaFermata.pendingInput).toEqual(SOSPENSIONE_3);

    await rispondi(utente.token, taskId, {
      kind: "BUSINESS_CONFIRMATION",
      action: "PROCEED",
    });

    const conclusa = await attendiEsito(ambiente.taskModel, taskId);
    expect({ status: conclusa.status, error: conclusa.error }).toMatchObject({
      status: "COMPLETED",
    });
    expect(conclusa.pendingInput).toBeNull();
    // Una invocazione e due riprese: la prima sospensione non e' arrivata
    // dall'agente, quindi il conto e' due e non tre.
    expect(ambiente.agente.invoke).toHaveBeenCalledTimes(1);
    expect(ambiente.agente.resume).toHaveBeenCalledTimes(2);
  }, 180_000);

  it("TI_09 (RF.57) — il tempo registrato somma solo i segmenti macchina", async () => {
    const utente = await utentePronto(ambiente.server, "PROJECT_MANAGER");
    agenteConTreSospensioni();

    const inizio = Date.now();
    const taskId = await avviaChangelogBusiness(utente);

    await attendiSospensione(taskId, "SPRINT_ID");
    await rispondi(utente.token, taskId, {
      kind: "SPRINT_ID",
      sprintId: "SPRINT-42",
    });
    await attendiSospensione(taskId, "INCOMPLETE_TASKS");
    await rispondi(utente.token, taskId, {
      kind: "INCOMPLETE_TASKS",
      action: "PROCEED",
    });
    await attendiSospensione(taskId, "BUSINESS_CONFIRMATION");
    await rispondi(utente.token, taskId, {
      kind: "BUSINESS_CONFIRMATION",
      action: "PROCEED",
    });

    const conclusa = await attendiEsito(ambiente.taskModel, taskId);
    const durataReale = Date.now() - inizio;

    const report = await ambiente.reportModel.findById(conclusa.reportId);
    const registrato = report!.durationMs!;

    // Almeno il tempo macchina dei due segmenti che passano dall'agente.
    expect(registrato).toBeGreaterThanOrEqual(2 * MS_PER_CHIAMATA);
    // E meno del tempo trascorso davvero, per un margine che non puo'
    // spiegarsi con la lentezza della macchina: le tre attese dell'utente
    // sommano da sole piu' di due secondi e mezzo.
    expect(registrato).toBeLessThan(durataReale - 2 * MS_ATTESA_UTENTE);
    // Il campo sulla Task e quello sul Report raccontano la stessa cosa.
    expect(conclusa.accumulatedMs).toBe(registrato);
  }, 180_000);

  it.each([
    ["SPRINT_ID", undefined],
    ["INCOMPLETE_TASKS", undefined],
    ["BUSINESS_CONFIRMATION", undefined],
  ])(
    "TI_10 — annullando sulla sospensione %s la task va a CANCELLED senza altre chiamate",
    async (fermata) => {
      const utente = await utentePronto(ambiente.server, "PROJECT_MANAGER");
      agenteConTreSospensioni();

      const taskId = await avviaChangelogBusiness(utente);
      await attendiSospensione(taskId, "SPRINT_ID");

      if (fermata !== "SPRINT_ID") {
        await rispondi(utente.token, taskId, {
          kind: "SPRINT_ID",
          sprintId: "SPRINT-42",
        });
        await attendiSospensione(taskId, "INCOMPLETE_TASKS");
      }
      if (fermata === "BUSINESS_CONFIRMATION") {
        await rispondi(utente.token, taskId, {
          kind: "INCOMPLETE_TASKS",
          action: "PROCEED",
        });
        await attendiSospensione(taskId, "BUSINESS_CONFIRMATION");
      }

      const invocazioniPrima = ambiente.agente.invoke.mock.calls.length;
      const riprePrima = ambiente.agente.resume.mock.calls.length;
      const issuePrima = ambiente.github.listIssues.mock.calls.length;

      await request(ambiente.server)
        .post(`/api/v1/tasks/${taskId}/cancel`)
        .set("Authorization", `Bearer ${utente.token}`)
        .expect(204);

      const annullata = await ambiente.taskModel.findById(taskId);
      expect(annullata!.status).toBe("CANCELLED");

      // Nessuna chiamata in piu' verso il modello o il Task Management dopo
      // l'annullamento: e' la garanzia di RF.99/102/105, e va guardata dopo
      // aver lasciato al worker il tempo di fare eventuali danni.
      await attendi(1_000);
      expect(ambiente.agente.invoke).toHaveBeenCalledTimes(invocazioniPrima);
      expect(ambiente.agente.resume).toHaveBeenCalledTimes(riprePrima);
      expect(ambiente.github.listIssues).toHaveBeenCalledTimes(issuePrima);
      expect((await ambiente.taskModel.findById(taskId))!.status).toBe("CANCELLED");
    },
    180_000,
  );

  it("TI_10 — annullare rispondendo CANCEL a una sospensione ha lo stesso effetto", async () => {
    // L'altra strada che l'interfaccia offre: il pulsante "Annulla" della
    // finestra di conferma, che passa da POST /tasks/:id/input e non da
    // /cancel.
    const utente = await utentePronto(ambiente.server, "PROJECT_MANAGER");
    agenteConTreSospensioni();

    const taskId = await avviaChangelogBusiness(utente);
    await attendiSospensione(taskId, "SPRINT_ID");
    await rispondi(utente.token, taskId, {
      kind: "SPRINT_ID",
      sprintId: "SPRINT-42",
    });
    await attendiSospensione(taskId, "INCOMPLETE_TASKS");

    const riprePrima = ambiente.agente.resume.mock.calls.length;

    await rispondi(utente.token, taskId, {
      kind: "INCOMPLETE_TASKS",
      action: "CANCEL",
    });

    const annullata = await ambiente.taskModel.findById(taskId);
    expect(annullata!.status).toBe("CANCELLED");
    expect(annullata!.pendingInput).toBeNull();

    await attendi(1_000);
    expect(ambiente.agente.resume).toHaveBeenCalledTimes(riprePrima);
  }, 180_000);

  it("TI_10 — una risposta arrivata dopo l’annullamento non fa partire l’agente", async () => {
    // Cio' che regge, ed e' la garanzia che conta per RF.99/102/105: il
    // filtro di claim() in TaskProcessor accetta solo PENDING e RUNNING,
    // quindi il job accodato da una risposta tardiva e' un nulla di fatto e
    // l'agente non viene mai interpellato. Il difetto documentato qui sotto
    // sta a monte, nella risposta che l'API restituisce.
    const utente = await utentePronto(ambiente.server, "PROJECT_MANAGER");
    agenteConTreSospensioni();

    const taskId = await avviaChangelogBusiness(utente);
    await attendiSospensione(taskId, "SPRINT_ID");

    await request(ambiente.server)
      .post(`/api/v1/tasks/${taskId}/cancel`)
      .set("Authorization", `Bearer ${utente.token}`)
      .expect(204);

    await request(ambiente.server)
      .post(`/api/v1/tasks/${taskId}/input`)
      .set("Authorization", `Bearer ${utente.token}`)
      .send({ kind: "SPRINT_ID", sprintId: "SPRINT-42" });

    await attendi(1_500);
    expect(ambiente.agente.invoke).not.toHaveBeenCalled();
    expect(ambiente.agente.resume).not.toHaveBeenCalled();
    expect((await ambiente.taskModel.findById(taskId))!.status).toBe("CANCELLED");
  }, 180_000);

  it("TI_10 — /cancel azzera pendingInput, e la task non accetta piu' risposte", async () => {
    // TasksService.cancel chiama markCancelled senza il `{ pendingInput:
    // null }` che invece passa il percorso CANCEL di POST /tasks/:id/input,
    // mentre il commento nel codice dichiara che i due percorsi compiono
    // "la stessa transizione". Non la compiono: dopo /cancel la task resta
    // CANCELLED con una richiesta di input ancora aperta, submitInput la
    // trova valida, risponde 204 e accoda un job per una task annullata.
    //
    // L'agente non parte comunque — lo verifica il test qui sopra — quindi
    // l'effetto e' contenuto: l'API conferma una risposta che non produrra'
    // nulla, e GET /tasks/:id continua a dichiarare un pendingInput su una
    // task terminale, che e' il campo su cui l'interfaccia decide se
    // mostrare la finestra di dialogo.
    const utente = await utentePronto(ambiente.server, "PROJECT_MANAGER");
    agenteConTreSospensioni();

    const taskId = await avviaChangelogBusiness(utente);
    await attendiSospensione(taskId, "SPRINT_ID");

    await request(ambiente.server)
      .post(`/api/v1/tasks/${taskId}/cancel`)
      .set("Authorization", `Bearer ${utente.token}`)
      .expect(204);

    const annullata = await ambiente.taskModel.findById(taskId);
    expect(annullata!.pendingInput).toBeNull();

    await request(ambiente.server)
      .post(`/api/v1/tasks/${taskId}/input`)
      .set("Authorization", `Bearer ${utente.token}`)
      .send({ kind: "SPRINT_ID", sprintId: "SPRINT-42" })
      .expect(409);
  }, 180_000);

  it("una risposta che non corrisponde alla sospensione in corso viene rifiutata", async () => {
    // Protegge dal caso in cui due schede aperte rispondano a due
    // sospensioni diverse della stessa task.
    const utente = await utentePronto(ambiente.server, "PROJECT_MANAGER");
    agenteConTreSospensioni();

    const taskId = await avviaChangelogBusiness(utente);
    await attendiSospensione(taskId, "SPRINT_ID");

    await request(ambiente.server)
      .post(`/api/v1/tasks/${taskId}/input`)
      .set("Authorization", `Bearer ${utente.token}`)
      .send({ kind: "BUSINESS_CONFIRMATION", action: "PROCEED" })
      .expect(409);

    const task = await ambiente.taskModel.findById(taskId);
    expect(task!.pendingInput?.kind).toBe("SPRINT_ID");
  }, 180_000);
});
