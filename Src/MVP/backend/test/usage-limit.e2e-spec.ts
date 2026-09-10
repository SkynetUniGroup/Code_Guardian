import { ConfigService } from "@nestjs/config";
import request from "supertest";
import { vi } from "vitest";
import { AmbienteE2E, attendiEsito, avviaAmbiente, utentePronto } from "./e2e-helpers";

/**
 * TI_15 (RF.66, RV.6) — il tetto mensile e' controllato prima
 * dell'accodamento, e un batch che lo supera viene respinto per intero.
 *
 * Le due meta' del requisito sono separabili e vanno verificate separatamente:
 * "prima dell'accodamento" e' una proprieta' sull'ordine (nessun job entra
 * nella coda), "senza accodare parzialmente" e' una proprieta'
 * sull'atomicita' (zero Task, non due su tre). Un test che guardasse solo il
 * 429 passerebbe anche a un backend che accoda le prime due operazioni e poi
 * si accorge del tetto sulla terza.
 *
 * Il contatore viene seminato direttamente su Mongo invece di consumare
 * cinquanta operazioni vere: il tetto configurato e' un parametro, e un test
 * che dipendesse dal suo valore andrebbe riscritto a ogni cambio di .env.
 */
describe("TI_15 (RF.66, RV.6) — tetto mensile prima dell'accodamento", () => {
  let ambiente: AmbienteE2E;
  let tetto: number;
  let spiaAccodamento: MockInstance;

  /** Il mese in corso nella forma "YYYY-MM" usata da UsageCounter. */
  function meseCorrente(): string {
    return new Date().toISOString().slice(0, 7);
  }

  /** Porta il contatore dell'utente al valore indicato. */
  async function seminaContatore(userId: string, count: number): Promise<void> {
    await ambiente.usageModel.updateOne(
      { userId, yearMonth: meseCorrente() },
      { $set: { count } },
      { upsert: true },
    );
  }

  /** Il consumo registrato per l'utente nel mese in corso. */
  async function consumo(userId: string): Promise<number> {
    const contatore = await ambiente.usageModel.findOne({
      userId,
      yearMonth: meseCorrente(),
    });
    return contatore?.count ?? 0;
  }

  beforeAll(async () => {
    ambiente = await avviaAmbiente();
    tetto = ambiente.app.get(ConfigService).get<number>("MONTHLY_TASK_LIMIT")!;
    // Il tetto e' configurabile: leggerlo invece di ripeterlo qui evita che
    // il test dipenda dal valore che .env ha oggi.
    expect(tetto).toBeGreaterThanOrEqual(3);
  }, 60_000);

  afterAll(async () => {
    await ambiente?.chiudi();
  });

  beforeEach(() => {
    ambiente.agente.invoke.mockReset();
    ambiente.agente.resume.mockReset();
    ambiente.agente.invoke.mockResolvedValue({
      status: "COMPLETED",
      payload: { body: [], summary: "nessun riscontro", tokensConsumed: 10 },
    });
    // La spia sull'accodamento e' l'unico modo diretto di distinguere
    // "controllato prima" da "controllato dopo aver accodato e poi
    // ripulito": guardare la lunghezza della coda non basta, il worker la
    // consuma da solo mentre il test guarda.
    spiaAccodamento = vi.spyOn(ambiente.coda, "addBulk");
  });

  afterEach(() => {
    spiaAccodamento.mockRestore();
  });

  it("un batch che supera il tetto e' respinto con 429 USAGE_LIMIT_EXCEEDED", async () => {
    const utente = await utentePronto(ambiente.server, "DEVELOPER");
    await seminaContatore(utente.userId, tetto - 1);

    const risposta = await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${utente.token}`)
      .send({
        contextId: utente.contextId,
        operations: ["DOCS_README", "DOCS_INLINE", "DOCS_API"],
      })
      .expect(429);

    expect(risposta.body.code).toBe("USAGE_LIMIT_EXCEEDED");
  }, 120_000);

  it("il controllo precede l'accodamento: nessun job entra in coda", async () => {
    const utente = await utentePronto(ambiente.server, "DEVELOPER");
    await seminaContatore(utente.userId, tetto - 1);

    await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${utente.token}`)
      .send({
        contextId: utente.contextId,
        operations: ["DOCS_README", "DOCS_INLINE", "DOCS_API"],
      })
      .expect(429);

    expect(spiaAccodamento).not.toHaveBeenCalled();
    expect(ambiente.agente.invoke).not.toHaveBeenCalled();
  }, 120_000);

  it("il rifiuto e' totale: nessuna operazione del batch viene persistita", async () => {
    // Il caso che distingue "respinto" da "respinto per intero": con due
    // slot residui e tre operazioni richieste, un backend che accodasse
    // finche' puo' ne persisterebbe due.
    const utente = await utentePronto(ambiente.server, "DEVELOPER");
    await seminaContatore(utente.userId, tetto - 2);

    await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${utente.token}`)
      .send({
        contextId: utente.contextId,
        operations: ["DOCS_README", "DOCS_INLINE", "DOCS_API"],
      })
      .expect(429);

    expect(await ambiente.taskModel.countDocuments({ userId: utente.userId })).toBe(0);
    expect(spiaAccodamento).not.toHaveBeenCalled();
  }, 120_000);

  it("un batch respinto non consuma la quota che aveva prenotato", async () => {
    // UsageLimitService incrementa e poi torna indietro: se la compensazione
    // saltasse, un utente al limite verrebbe respinto e per giunta pagherebbe
    // le tre operazioni mai eseguite, e ogni tentativo successivo lo
    // allontanerebbe ancora.
    const utente = await utentePronto(ambiente.server, "DEVELOPER");
    await seminaContatore(utente.userId, tetto - 1);

    await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${utente.token}`)
      .send({
        contextId: utente.contextId,
        operations: ["DOCS_README", "DOCS_INLINE", "DOCS_API"],
      })
      .expect(429);

    expect(await consumo(utente.userId)).toBe(tetto - 1);
  }, 120_000);

  it("un batch che ci sta esattamente viene accettato e accodato per intero", async () => {
    // Il controllo positivo: senza, tutte le asserzioni "non e' successo
    // niente" qui sopra sarebbero soddisfatte anche da un endpoint che
    // rifiuta sempre.
    const utente = await utentePronto(ambiente.server, "DEVELOPER");
    await seminaContatore(utente.userId, tetto - 3);

    const avvio = await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${utente.token}`)
      .send({
        contextId: utente.contextId,
        operations: ["DOCS_README", "DOCS_INLINE", "DOCS_API"],
      })
      .expect(202);

    expect(avvio.body.taskIds).toHaveLength(3);
    expect(spiaAccodamento).toHaveBeenCalledTimes(1);
    expect(await consumo(utente.userId)).toBe(tetto);
    expect(await ambiente.taskModel.countDocuments({ userId: utente.userId })).toBe(3);

    // Le tre task arrivano davvero in fondo: il tetto non ha lasciato
    // qualcosa a meta'.
    for (const taskId of avvio.body.taskIds as string[]) {
      const conclusa = await attendiEsito(ambiente.taskModel, taskId);
      expect(conclusa.status).toBe("COMPLETED");
    }
  }, 180_000);

  it("esaurito il tetto, anche una sola operazione viene respinta", async () => {
    const utente = await utentePronto(ambiente.server, "DEVELOPER");
    await seminaContatore(utente.userId, tetto);

    const risposta = await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${utente.token}`)
      .send({ contextId: utente.contextId, operations: ["DOCS_README"] })
      .expect(429);

    expect(risposta.body.code).toBe("USAGE_LIMIT_EXCEEDED");
    expect(await consumo(utente.userId)).toBe(tetto);
    expect(spiaAccodamento).not.toHaveBeenCalled();
  }, 120_000);

  it("il tetto e' per utente: quello di uno non tocca quello di un altro", async () => {
    // RF.66 parla di tetto mensile "per utente": un contatore condiviso
    // renderebbe il servizio inutilizzabile appena due persone lo usano.
    const esaurito = await utentePronto(ambiente.server, "DEVELOPER");
    const nuovo = await utentePronto(ambiente.server, "DEVELOPER");
    await seminaContatore(esaurito.userId, tetto);

    await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${esaurito.token}`)
      .send({ contextId: esaurito.contextId, operations: ["DOCS_README"] })
      .expect(429);

    await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${nuovo.token}`)
      .send({ contextId: nuovo.contextId, operations: ["DOCS_README"] })
      .expect(202);

    expect(await consumo(nuovo.userId)).toBe(1);
  }, 180_000);
});
