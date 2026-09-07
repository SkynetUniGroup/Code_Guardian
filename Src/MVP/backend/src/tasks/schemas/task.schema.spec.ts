import { TaskSchema } from './task.schema';
import type { TaskStatus } from '../task.types';

// BE-1 ("schemi e indici") declared indexes on User, ServiceCredential and
// Report but none on Task, and nothing since noticed: an index is invisible
// until it is missing under load, and no unit test had a reason to look. This
// one exists so that deleting an index is a deliberate act with a failing
// test attached, the same way the unique index on ServiceCredential is
// load-bearing for "reconnecting a provider replaces the record".
describe('TaskSchema indexes', () => {
  const declared = TaskSchema.indexes().map(([fields]) => fields);

  it('covers the batch-completion tally by batchId and status', () => {
    // maybeEmitBatchCompleted runs three countDocuments on this shape at the
    // end of every single job.
    expect(declared).toContainEqual({ batchId: 1, status: 1 });
  });

  it('covers the dashboard list query by owner and recency', () => {
    // findAllForUser: find({ userId }).sort({ createdAt: -1 }) — the sort
    // direction is part of the index, not an afterthought, or it is done in
    // memory over every Task the user has ever created.
    expect(declared).toContainEqual({ userId: 1, createdAt: -1 });
  });
});

/**
 * TU_19 (RF.46) — transizioni di stato ammesse della Task.
 *
 * canTransitionTo vive su TaskSchema.methods, non nel corpo della classe
 * Task (il commento in task.schema.ts spiega perché): si invoca quindi con
 * un `this` finto che porti soltanto lo `status` di partenza, che è l'unico
 * campo del documento che il metodo legge.
 */
describe('TU_19 (RF.46) — transizioni di stato ammesse della Task', () => {
  const STATI: TaskStatus[] = [
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ];

  // Il ciclo di vita come lo descrive RF.46, riscritto qui perché il test
  // confronti il codice con la specifica e non con se stesso. Il tipo
  // Record<TaskStatus, ...> è la parte che regge l'esaustività: aggiungere un
  // sesto stato a TaskStatus senza toccare questa tabella non compila.
  const AMMESSE: Record<TaskStatus, TaskStatus[]> = {
    PENDING: ['RUNNING', 'CANCELLED'],
    RUNNING: ['COMPLETED', 'FAILED', 'CANCELLED'],
    COMPLETED: [],
    FAILED: [],
    CANCELLED: [],
  };

  const TERMINALI: TaskStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

  /** Invoca il metodo dello schema su una Task che si trova in `da`. */
  function transita(da: string, a: TaskStatus): boolean {
    const metodo = TaskSchema.methods.canTransitionTo as (
      this: { status: string },
      newStatus: TaskStatus,
    ) => boolean;
    return metodo.call({ status: da }, a);
  }

  /** Gli stati che, partendo da `da`, il metodo accetta davvero. */
  function accettatiDa(da: string): TaskStatus[] {
    return STATI.filter((a) => transita(da, a));
  }

  it('accetta tutte e sole le transizioni previste, su tutte le venticinque coppie', () => {
    // "Tutte e sole": il confronto è fra due mappe complete, non fra singole
    // coppie, quindi una transizione ammessa in più e una in meno falliscono
    // entrambe, e il messaggio dice quale.
    const effettive = Object.fromEntries(
      STATI.map((da) => [da, accettatiDa(da)]),
    );
    expect(effettive).toEqual(AMMESSE);
  });

  it('da PENDING ammette RUNNING e CANCELLED, e nient\'altro', () => {
    expect(accettatiDa('PENDING')).toEqual(['RUNNING', 'CANCELLED']);
  });

  it('da RUNNING ammette COMPLETED, FAILED e CANCELLED, e nient\'altro', () => {
    expect(accettatiDa('RUNNING')).toEqual([
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ]);
  });

  it.each(TERMINALI)(
    'da %s, stato terminale, non ammette alcuna uscita',
    (terminale) => {
      expect(accettatiDa(terminale)).toEqual([]);
    },
  );

  it('nessuno stato ammette la transizione verso se stesso', () => {
    // Non è un caso a parte nella tabella: PENDING -> PENDING sarebbe una
    // riscrittura senza effetto, ma anche il segnale che due worker stanno
    // agendo sulla stessa Task.
    const idempotenti = STATI.filter((stato) => transita(stato, stato));
    expect(idempotenti).toEqual([]);
  });

  it('uno stato fuori catalogo rifiuta ogni transizione invece di sollevare', () => {
    // Il `?? false` in fondo al metodo: una Task scritta da una versione
    // precedente, o corrotta a mano su Mongo, non deve far cadere il worker
    // che la legge — deve solo risultare bloccata.
    expect(accettatiDa('IN_ATTESA_DI_UTENTE')).toEqual([]);
    expect(accettatiDa('')).toEqual([]);
  });
});
