import request from "supertest";
import { TaskDocument } from "./../src/tasks/schemas/task.schema";
import { AmbienteE2E, attendiEsito, avviaAmbiente, utentePronto } from "./e2e-helpers";

/**
 * TI_11 (RF.48) — le task di uno stesso batch sono elaborate in isolamento.
 *
 * task-processor.spec.ts verifica lo stesso processore a livello di unita',
 * una task per volta e con tutto sostituito attorno. Qui la domanda e' quella
 * che l'unita' non puo' porre: quando tre task nate dalla stessa POST /tasks
 * passano per lo stesso worker, la stessa connessione a Mongo e la stessa
 * coda, il fallimento di una lascia davvero intatte le altre? Lo stato che
 * potrebbe far trapelare il guasto — il claim, il Report in assemblaggio,
 * l'errore sulla task — e' condiviso a livello di processo, non di task.
 *
 * L'esito atteso viene deciso per codice operazione, non per ordine di
 * arrivo: BullMQ non garantisce l'ordine, e un test che si aspettasse "la
 * seconda fallisce" sarebbe intermittente per costruzione.
 */
describe("TI_11 (RF.48) — isolamento fra le task dello stesso batch", () => {
  let ambiente: AmbienteE2E;

  const OPERAZIONI = ["DOCS_README", "DOCS_INLINE", "DOCS_API"] as const;

  /** Risposta di un agente riuscito, riconoscibile dall'operazione. */
  function esitoRiuscito(operazione: string) {
    return {
      status: "COMPLETED",
      payload: {
        body: [
          {
            kind: "TEXT",
            order: 0,
            markdown: `Esito di ${operazione}.`,
          },
        ],
        summary: `Riepilogo di ${operazione}.`,
        tokensConsumed: 100,
      },
    };
  }

  /** Avvia il batch e attende che tutte e tre le task siano concluse. */
  async function eseguiBatch(token: string, contextId: string): Promise<Map<string, TaskDocument>> {
    const avvio = await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ contextId, operations: [...OPERAZIONI] })
      .expect(202);

    const taskIds = avvio.body.taskIds as string[];
    expect(taskIds).toHaveLength(3);

    const concluse = new Map<string, TaskDocument>();
    for (const taskId of taskIds) {
      const task = await attendiEsito(ambiente.taskModel, taskId);
      concluse.set(task.operation, task);
    }
    return concluse;
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
  });

  it("il fallimento di una task non altera stato ne' esito delle altre", async () => {
    const utente = await utentePronto(ambiente.server, "DEVELOPER");

    // DOCS_INLINE fallisce con un errore di parsing; le altre due riescono.
    ambiente.agente.invoke.mockImplementation((task: TaskDocument) =>
      Promise.resolve(
        task.operation === "DOCS_INLINE"
          ? {
              status: "FAILED",
              error: {
                code: "PARSING",
                message: "risposta del modello non interpretabile",
                stage: "EXECUTION",
              },
            }
          : esitoRiuscito(task.operation),
      ),
    );

    const concluse = await eseguiBatch(utente.token, utente.contextId);

    const fallita = concluse.get("DOCS_INLINE")!;
    expect(fallita.status).toBe("FAILED");
    expect(fallita.error?.code).toBe("PARSING");

    for (const operazione of ["DOCS_README", "DOCS_API"]) {
      const task = concluse.get(operazione)!;
      // L'errore incluso nel confronto: se una di queste fallisse, sapere
      // *quale* errore ha ereditato e' esattamente l'informazione che serve.
      expect({ operazione, status: task.status, error: task.error }).toEqual({
        operazione,
        status: "COMPLETED",
        error: null,
      });
      expect(task.reportId).toBeTruthy();
    }
  }, 180_000);

  it("ogni task del batch ha un Report proprio, col contenuto della propria operazione", async () => {
    // Il modo in cui l'isolamento si romperebbe senza che lo stato lo mostri:
    // tre task COMPLETED che puntano tutte allo stesso Report, o a Report col
    // contenuto di un'altra operazione.
    const utente = await utentePronto(ambiente.server, "DEVELOPER");
    ambiente.agente.invoke.mockImplementation((task: TaskDocument) =>
      Promise.resolve(esitoRiuscito(task.operation)),
    );

    const concluse = await eseguiBatch(utente.token, utente.contextId);

    const reportIds = new Set<string>();
    for (const operazione of OPERAZIONI) {
      const task = concluse.get(operazione)!;
      expect(task.status).toBe("COMPLETED");
      reportIds.add(String(task.reportId));

      const letto = await request(ambiente.server)
        .get(`/api/v1/reports/${task.reportId}`)
        .set("Authorization", `Bearer ${utente.token}`)
        .expect(200);

      expect(letto.body.operation).toBe(operazione);
      expect(letto.body.summary).toBe(`Riepilogo di ${operazione}.`);
    }
    expect(reportIds.size).toBe(3);
  }, 180_000);

  it("un'eccezione sollevata durante una task non travolge le altre", async () => {
    // Diverso dal caso sopra: qui l'agente non risponde "FAILED", esplode.
    // E' il percorso del catch di TaskProcessor, quello in cui un guasto puo'
    // davvero uscire dai confini della singola task.
    const utente = await utentePronto(ambiente.server, "DEVELOPER");
    ambiente.agente.invoke.mockImplementation((task: TaskDocument) =>
      task.operation === "DOCS_API"
        ? Promise.reject(new Error("il servizio agenti ha chiuso la connessione"))
        : Promise.resolve(esitoRiuscito(task.operation)),
    );

    const concluse = await eseguiBatch(utente.token, utente.contextId);

    expect(concluse.get("DOCS_API")!.status).toBe("FAILED");
    expect(concluse.get("DOCS_README")!.status).toBe("COMPLETED");
    expect(concluse.get("DOCS_INLINE")!.status).toBe("COMPLETED");
  }, 180_000);

  it("anche una task fallita lascia un Report leggibile, non un buco", async () => {
    // RF.48 riguarda le altre task, ma la task fallita non deve sparire: il
    // suo Report FAILED e' cio' che distingue "fallita" da "mai eseguita".
    const utente = await utentePronto(ambiente.server, "DEVELOPER");
    ambiente.agente.invoke.mockImplementation((task: TaskDocument) =>
      Promise.resolve(
        task.operation === "DOCS_INLINE"
          ? {
              status: "FAILED",
              error: {
                code: "TIMEOUT",
                message: "nessuna risposta dal modello",
                stage: "EXECUTION",
              },
            }
          : esitoRiuscito(task.operation),
      ),
    );

    const concluse = await eseguiBatch(utente.token, utente.contextId);
    const fallita = concluse.get("DOCS_INLINE")!;

    expect(fallita.reportId).toBeTruthy();
    const letto = await request(ambiente.server)
      .get(`/api/v1/reports/${fallita.reportId}`)
      .set("Authorization", `Bearer ${utente.token}`)
      .expect(200);

    expect(letto.body.status).toBe("FAILED");
    expect(letto.body.operation).toBe("DOCS_INLINE");
  }, 180_000);

  it("le task del batch restano dello stesso batch, e nessuna ne trascina un'altra", async () => {
    // Il batchId e' la sola cosa che le tre condividono per progettazione:
    // e' bene che resti condiviso, ed e' bene che sia l'unica.
    const utente = await utentePronto(ambiente.server, "DEVELOPER");
    ambiente.agente.invoke.mockImplementation((task: TaskDocument) =>
      Promise.resolve(
        task.operation === "DOCS_README"
          ? {
              status: "FAILED",
              error: {
                code: "UPSTREAM",
                message: "il servizio agenti ha risposto 502",
                stage: "EXECUTION",
              },
            }
          : esitoRiuscito(task.operation),
      ),
    );

    const concluse = await eseguiBatch(utente.token, utente.contextId);

    const batchIds = new Set([...concluse.values()].map((t) => t.batchId));
    expect(batchIds.size).toBe(1);

    const esiti = [...concluse.values()].map((t) => t.status).sort();
    expect(esiti).toEqual(["COMPLETED", "COMPLETED", "FAILED"]);
    expect(ambiente.agente.invoke).toHaveBeenCalledTimes(3);
  }, 180_000);
});
