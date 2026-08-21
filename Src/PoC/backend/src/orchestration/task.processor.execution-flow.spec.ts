/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { TaskProcessor } from './task.processor.js';
import { getModelToken } from '@nestjs/mongoose';
import { Task } from '../domain/schemas/task.schema.js';
import { Report } from '../domain/schemas/report.schema.js';
import { AnalysisContext } from '../domain/schemas/analysis-context.schema.js';
import { AgentRegistry } from './agent.registry.js';
import { AgentGatewayService } from './agent-gateway.service.js';
import { EventsGateway } from '../public/events.gateway.js';
import { Job } from 'bullmq';

/**
 * Copre il ciclo di vita completo del TaskProcessor oltre al percorso di
 * cancellazione cooperativa (gia' testato in task.processor.spec.ts):
 * percorso nominale (happy path), assenza di task/contesto, transizioni di
 * stato non permesse, e -- in particolare -- la cattura delle eccezioni
 * dell'agente (come un timeout del provider LLM propagato dall'
 * AgentGatewayService) e la loro conversione in un Report FAILED codificato.
 */
describe('TaskProcessor - Ciclo di vita ed esecuzione dell\'agente', () => {
  let processor: TaskProcessor;
  let mockTaskModel: any;
  let mockReportInstances: any[];
  let MockReportModel: any;
  let mockContextModel: any;
  let mockGateway: any;
  let mockEvents: any;

  const descriptor = { agentId: 'security', operation: 'SECURITY_OWASP', destinationUrl: '/agents/security/run' };

  beforeEach(async () => {
    mockTaskModel = {
      findById: jest.fn(),
      countDocuments: jest.fn(),
    };

    mockReportInstances = [];
    MockReportModel = class {
      constructor(data: any) {
        Object.assign(this, data);
        (this as any)._id = { toString: () => 'report-generated-id' };
        mockReportInstances.push(this);
      }
      save() {
        return Promise.resolve(this);
      }
    };

    mockContextModel = {
      findById: jest.fn(),
    };

    mockGateway = { invokeAgent: jest.fn() };
    mockEvents = {
      emitTaskUpdated: jest.fn(),
      emitTaskFailed: jest.fn(),
      emitBatchCompleted: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskProcessor,
        { provide: getModelToken(Task.name), useValue: mockTaskModel },
        { provide: getModelToken(Report.name), useValue: MockReportModel },
        { provide: getModelToken(AnalysisContext.name), useValue: mockContextModel },
        { provide: AgentRegistry, useValue: { getByOperationCode: jest.fn().mockReturnValue(descriptor) } },
        { provide: AgentGatewayService, useValue: mockGateway },
        { provide: EventsGateway, useValue: mockEvents },
      ],
    }).compile();

    processor = module.get<TaskProcessor>(TaskProcessor);
  });

  function makeTask(overrides: Partial<any> = {}) {
    return {
      _id: 'task-1',
      userId: 'user-1',
      batchId: 'batch-1',
      operation: 'SECURITY_OWASP',
      status: 'PENDING',
      canTransitionTo: jest.fn().mockReturnValue(true),
      save: jest.fn().mockResolvedValue(true),
      ...overrides,
    };
  }

  const job = { data: { taskId: 'task-1' } } as Job;

  it('dovrebbe interrompersi silenziosamente se la task non esiste piu\' sul DB', async () => {
    mockTaskModel.findById.mockResolvedValue(null);

    await processor.process(job);

    expect(mockGateway.invokeAgent).not.toHaveBeenCalled();
    expect(mockEvents.emitTaskUpdated).not.toHaveBeenCalled();
  });

  it('non dovrebbe procedere se la transizione a RUNNING non e\' permessa dallo stato corrente', async () => {
    const task = makeTask({ status: 'COMPLETED' });
    task.canTransitionTo.mockReturnValue(false);
    mockTaskModel.findById.mockResolvedValue(task);

    await processor.process(job);

    expect(task.save).not.toHaveBeenCalled();
    expect(mockGateway.invokeAgent).not.toHaveBeenCalled();
  });

  it('dovrebbe marcare la task FAILED con codice CONTEXT_MISSING se il contesto di analisi non esiste', async () => {
    const task = makeTask();
    mockTaskModel.findById.mockResolvedValue(task);
    mockContextModel.findById.mockResolvedValue(null);
    mockTaskModel.countDocuments.mockResolvedValue(0);

    await processor.process(job);

    expect(task.status).toBe('FAILED');
    expect(task.error).toEqual({ code: 'CONTEXT_MISSING', message: 'Contesto non trovato nel DB', stage: 'init' });
    expect(mockEvents.emitTaskFailed).toHaveBeenCalledWith('task-1', task.error, 'user-1');
    expect(mockEvents.emitTaskUpdated).toHaveBeenCalledWith('task-1', 'FAILED', undefined, 'user-1');
    // Anche su questo ramo il completamento del batch va comunque verificato
    expect(mockEvents.emitBatchCompleted).toHaveBeenCalled();
    expect(mockGateway.invokeAgent).not.toHaveBeenCalled();
  });

  describe('percorso nominale (happy path)', () => {
    it('dovrebbe salvare il report COMPLETED e transire la task a COMPLETED', async () => {
      const task = makeTask();
      const currentTaskAfterRun = makeTask({ status: 'RUNNING' });
      mockTaskModel.findById
        .mockResolvedValueOnce(task) // fetch iniziale
        .mockResolvedValueOnce(currentTaskAfterRun); // refetch post-agente
      mockContextModel.findById.mockResolvedValue({
        repoOwner: 'acme', repoName: 'demo', resolvedSha: 'sha1', scopeType: 'FULL_REPOSITORY', paths: [],
      });
      mockGateway.invokeAgent.mockResolvedValue({
        agentId: 'security', operation: 'SECURITY_OWASP', status: 'COMPLETED',
        summary: 'Scansione completata', durationMs: 500, tokensConsumed: 120,
        body: [{ kind: 'finding', order: 0 }],
      });
      mockTaskModel.countDocuments.mockResolvedValue(0);

      await processor.process(job);

      expect(task.status).toBe('RUNNING');
      expect(currentTaskAfterRun.status).toBe('COMPLETED');
      expect(currentTaskAfterRun.progressPercent).toBe(100);
      expect(currentTaskAfterRun.reportId).toBe(mockReportInstances[0]._id);
      expect(currentTaskAfterRun.error).toBeNull();
      expect(mockReportInstances[0].status).toBe('COMPLETED');
      expect(mockEvents.emitTaskFailed).not.toHaveBeenCalled();
      expect(mockEvents.emitTaskUpdated).toHaveBeenCalledWith('task-1', 'COMPLETED', 'report-generated-id', 'user-1');
    });

    it('dovrebbe applicare i valori di default quando l\'agente restituisce un payload parziale', async () => {
      const task = makeTask();
      const currentTaskAfterRun = makeTask({ status: 'RUNNING' });
      mockTaskModel.findById.mockResolvedValueOnce(task).mockResolvedValueOnce(currentTaskAfterRun);
      mockContextModel.findById.mockResolvedValue({ repoOwner: 'a', repoName: 'b', resolvedSha: 'c', scopeType: 'FULL_REPOSITORY' });
      // L'agente non restituisce ne' status ne' body: solo 'blocks' (retrocompatibilita')
      mockGateway.invokeAgent.mockResolvedValue({ blocks: [{ kind: 'text', order: 0 }] });
      mockTaskModel.countDocuments.mockResolvedValue(0);

      await processor.process(job);

      const savedReport = mockReportInstances[0];
      expect(savedReport.status).toBe('COMPLETED'); // default quando reportData.status manca
      expect(savedReport.durationMs).toBe(0);
      expect(savedReport.tokensConsumed).toBe(0);
      expect(savedReport.summary).toBe('');
      expect(savedReport.body).toEqual([{ kind: 'text', order: 0 }]); // fallback su reportData.blocks
      expect(savedReport.agentId).toBe(descriptor.agentId); // fallback sul descrittore statico
      expect(savedReport.operation).toBe(descriptor.operation);
    });
  });

  describe('cattura delle eccezioni dell\'agente (timeout del provider LLM propagato dal Gateway)', () => {
    it('dovrebbe convertire un\'eccezione lanciata dal Gateway (es. RequestTimeoutException) in un Report FAILED con kind UPSTREAM', async () => {
      const task = makeTask();
      const currentTaskAfterRun = makeTask({ status: 'RUNNING' });
      mockTaskModel.findById.mockResolvedValueOnce(task).mockResolvedValueOnce(currentTaskAfterRun);
      mockContextModel.findById.mockResolvedValue({ repoOwner: 'a', repoName: 'b', resolvedSha: 'c', scopeType: 'FULL_REPOSITORY' });
      mockGateway.invokeAgent.mockRejectedValue(
        new Error('Timeout dell\'agente (superati i 100 secondi di attesa totale)'),
      );
      mockTaskModel.countDocuments.mockResolvedValue(0);

      await processor.process(job);

      const savedReport = mockReportInstances[0];
      expect(savedReport.status).toBe('FAILED');
      expect(savedReport.error).toEqual({
        kind: 'UPSTREAM',
        message: 'Timeout dell\'agente (superati i 100 secondi di attesa totale)',
        stage: 'agent_invocation',
      });
      expect(savedReport.body).toEqual([]);

      expect(currentTaskAfterRun.status).toBe('FAILED');
      expect(currentTaskAfterRun.error).toEqual(savedReport.error);
      expect(mockEvents.emitTaskFailed).toHaveBeenCalledWith('task-1', savedReport.error, 'user-1');
      expect(mockEvents.emitTaskUpdated).toHaveBeenCalledWith('task-1', 'FAILED', 'report-generated-id', 'user-1');
    });

    it('dovrebbe gestire correttamente anche il rifiuto di una stringa/valore non-Error', async () => {
      const task = makeTask();
      const currentTaskAfterRun = makeTask({ status: 'RUNNING' });
      mockTaskModel.findById.mockResolvedValueOnce(task).mockResolvedValueOnce(currentTaskAfterRun);
      mockContextModel.findById.mockResolvedValue({ repoOwner: 'a', repoName: 'b', resolvedSha: 'c', scopeType: 'FULL_REPOSITORY' });
      mockGateway.invokeAgent.mockRejectedValue('errore grezzo non standard');
      mockTaskModel.countDocuments.mockResolvedValue(0);

      await processor.process(job);

      expect(mockReportInstances[0].error.message).toBe('errore grezzo non standard');
    });

    it('dovrebbe preservare il kind TIMEOUT/PARSING gia\' assegnato dall\'agente quando la chiamata HTTP va a buon fine ma il contenuto e\' un fallimento applicativo', async () => {
      // Qui il Gateway NON lancia: l'agente ha risposto regolarmente con un
      // proprio esito FAILED (es. ha classificato un timeout interno di LangGraph).
      const task = makeTask();
      const currentTaskAfterRun = makeTask({ status: 'RUNNING' });
      mockTaskModel.findById.mockResolvedValueOnce(task).mockResolvedValueOnce(currentTaskAfterRun);
      mockContextModel.findById.mockResolvedValue({ repoOwner: 'a', repoName: 'b', resolvedSha: 'c', scopeType: 'FULL_REPOSITORY' });
      mockGateway.invokeAgent.mockResolvedValue({
        agentId: 'security', operation: 'SECURITY_OWASP', status: 'FAILED',
        error: { kind: 'TIMEOUT', message: 'Agent global timeout exceeded', stage: 'invoca_llm' },
        body: [],
      });
      mockTaskModel.countDocuments.mockResolvedValue(0);

      await processor.process(job);

      expect(mockReportInstances[0].error.kind).toBe('TIMEOUT'); // non riscritto a UPSTREAM
      expect(currentTaskAfterRun.status).toBe('FAILED');
    });
  });

  describe('transizioni di stato scartate per concorrenza', () => {
    it('dovrebbe scartare l\'esito (senza aggiornare la task) se nel frattempo la task e\' finita in uno stato terminale non compatibile', async () => {
      const task = makeTask();
      const concurrentlyCancelledTask = makeTask({ status: 'CANCELLED' });
      concurrentlyCancelledTask.canTransitionTo.mockReturnValue(false);
      mockTaskModel.findById.mockResolvedValueOnce(task).mockResolvedValueOnce(concurrentlyCancelledTask);
      mockContextModel.findById.mockResolvedValue({ repoOwner: 'a', repoName: 'b', resolvedSha: 'c', scopeType: 'FULL_REPOSITORY' });
      mockGateway.invokeAgent.mockResolvedValue({ status: 'COMPLETED', body: [] });

      await processor.process(job);

      expect(concurrentlyCancelledTask.save).not.toHaveBeenCalled();
      expect(mockEvents.emitTaskUpdated).not.toHaveBeenCalled();
    });

    it('dovrebbe interrompersi senza errori se la task e\' stata eliminata tra il salvataggio del report e il refetch', async () => {
      const task = makeTask();
      mockTaskModel.findById.mockResolvedValueOnce(task).mockResolvedValueOnce(null);
      mockContextModel.findById.mockResolvedValue({ repoOwner: 'a', repoName: 'b', resolvedSha: 'c', scopeType: 'FULL_REPOSITORY' });
      mockGateway.invokeAgent.mockResolvedValue({ status: 'COMPLETED', body: [] });

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(mockEvents.emitTaskUpdated).not.toHaveBeenCalled();
    });
  });

  describe('cancellazione cooperativa: casi limite non coperti dal file dedicato', () => {
    it('non dovrebbe salvare ne\' emettere nulla se, al momento del refetch, la task cancellata non e\' piu\' presente', async () => {
      const task = makeTask();
      mockTaskModel.findById.mockResolvedValueOnce(task).mockResolvedValueOnce(null);
      mockContextModel.findById.mockResolvedValue({ repoOwner: 'a', repoName: 'b', resolvedSha: 'c', scopeType: 'FULL_REPOSITORY' });
      mockGateway.invokeAgent.mockResolvedValue({ status: 'CANCELLED', stage: 'invoca_llm' });

      await processor.process(job);

      expect(mockEvents.emitTaskUpdated).not.toHaveBeenCalled();
      expect(mockEvents.emitBatchCompleted).not.toHaveBeenCalled();
    });

    it('non dovrebbe transire se la task non e\' piu\' in uno stato compatibile con CANCELLED', async () => {
      const task = makeTask();
      const alreadyCompletedTask = makeTask({ status: 'COMPLETED' });
      alreadyCompletedTask.canTransitionTo.mockReturnValue(false);
      mockTaskModel.findById.mockResolvedValueOnce(task).mockResolvedValueOnce(alreadyCompletedTask);
      mockContextModel.findById.mockResolvedValue({ repoOwner: 'a', repoName: 'b', resolvedSha: 'c', scopeType: 'FULL_REPOSITORY' });
      mockGateway.invokeAgent.mockResolvedValue({ status: 'CANCELLED', stage: 'invoca_llm' });

      await processor.process(job);

      expect(alreadyCompletedTask.save).not.toHaveBeenCalled();
      expect(mockEvents.emitTaskUpdated).not.toHaveBeenCalled();
    });
  });

  describe('_checkAndEmitBatchCompletion (via il flusso standard)', () => {
    it('dovrebbe emettere batch.completed con i conteggi corretti quando nessuna task del batch e\' piu\' PENDING/RUNNING', async () => {
      const task = makeTask();
      const currentTaskAfterRun = makeTask({ status: 'RUNNING' });
      mockTaskModel.findById.mockResolvedValueOnce(task).mockResolvedValueOnce(currentTaskAfterRun);
      mockContextModel.findById.mockResolvedValue({ repoOwner: 'a', repoName: 'b', resolvedSha: 'c', scopeType: 'FULL_REPOSITORY' });
      mockGateway.invokeAgent.mockResolvedValue({ status: 'COMPLETED', body: [] });
      mockTaskModel.countDocuments
        .mockResolvedValueOnce(0) // nessuna PENDING/RUNNING rimasta
        .mockResolvedValueOnce(3) // completate
        .mockResolvedValueOnce(1); // fallite/annullate

      await processor.process(job);

      expect(mockEvents.emitBatchCompleted).toHaveBeenCalledWith('batch-1', 3, 1, 'user-1');
    });

    it('non dovrebbe emettere batch.completed se ci sono ancora task PENDING/RUNNING nel batch', async () => {
      const task = makeTask();
      const currentTaskAfterRun = makeTask({ status: 'RUNNING' });
      mockTaskModel.findById.mockResolvedValueOnce(task).mockResolvedValueOnce(currentTaskAfterRun);
      mockContextModel.findById.mockResolvedValue({ repoOwner: 'a', repoName: 'b', resolvedSha: 'c', scopeType: 'FULL_REPOSITORY' });
      mockGateway.invokeAgent.mockResolvedValue({ status: 'COMPLETED', body: [] });
      mockTaskModel.countDocuments.mockResolvedValueOnce(2); // ancora 2 task in corso nel batch

      await processor.process(job);

      expect(mockEvents.emitBatchCompleted).not.toHaveBeenCalled();
    });
  });
});
