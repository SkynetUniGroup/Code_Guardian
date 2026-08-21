/// <reference types="jest" />
import { TaskQueueService } from './task-queue.service.js';

describe('TaskQueueService', () => {
  let service: TaskQueueService;
  let mockQueue: { add: jest.Mock; getJob: jest.Mock };

  beforeEach(() => {
    mockQueue = {
      add: jest.fn().mockResolvedValue(undefined),
      getJob: jest.fn(),
    };
    // Istanziazione diretta: l'unica dipendenza e' la Queue BullMQ, iniettata
    // via costruttore. Evita di doversi legare al token esatto di @InjectQueue.
    service = new TaskQueueService(mockQueue as any);
  });

  describe('enqueue', () => {
    it('dovrebbe accodare il job "execute-agent" usando l\'id della task come jobId (idempotenza)', async () => {
      const task: any = { _id: { toString: () => 'task-abc' } };

      await service.enqueue(task);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'execute-agent',
        { taskId: 'task-abc' },
        { jobId: 'task-abc' },
      );
    });

    it('dovrebbe ritornare senza attendere alcun risultato oltre alla conferma di accodamento (ADR-3: non blocca il ciclo HTTP)', async () => {
      const task: any = { _id: { toString: () => 'task-xyz' } };

      await expect(service.enqueue(task)).resolves.toBeUndefined();
    });
  });

  describe('removeTask', () => {
    it('dovrebbe rimuovere il job dalla coda se presente', async () => {
      const mockJob = { remove: jest.fn().mockResolvedValue(undefined) };
      mockQueue.getJob.mockResolvedValue(mockJob);

      await service.removeTask('task-abc');

      expect(mockQueue.getJob).toHaveBeenCalledWith('task-abc');
      expect(mockJob.remove).toHaveBeenCalledTimes(1);
    });

    it('non dovrebbe fallire ne\' tentare la rimozione se il job non esiste piu\' in coda', async () => {
      mockQueue.getJob.mockResolvedValue(undefined);

      await expect(service.removeTask('task-non-esistente')).resolves.toBeUndefined();
    });
  });
});
