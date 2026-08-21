/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { TaskController } from './task.controller.js';
import { Task } from '../domain/schemas/task.schema.js';
import { TaskQueueService } from '../orchestration/task-queue.service.js';
import { OrchestratorService } from '../orchestration/orchestrator.service.js';
import { EventsGateway } from './events.gateway.js';

/**
 * Completa la copertura di TaskController oltre al percorso di
 * cancellazione cooperativa (gia' testato in task.controller.spec.ts):
 * creazione batch di task (con instradamento tramite l'Orchestratore),
 * lettura, e il ramo PENDING di cancellazione.
 */
describe('TaskController - creazione e interrogazione delle task', () => {
  let controller: TaskController;
  let mockTaskModelCtor: jest.Mock & { find: jest.Mock; findOne: jest.Mock };
  let mockQueueService: { enqueue: jest.Mock; removeTask: jest.Mock };
  let mockOrchestrator: { resolve: jest.Mock };
  let mockEventsGateway: { emitTaskUpdated: jest.Mock };
  let mockRedis: { set: jest.Mock };
  let savedInstances: any[];

  beforeEach(async () => {
    savedInstances = [];
    mockTaskModelCtor = jest.fn().mockImplementation((data: any) => {
      // L'indice va catturato ORA (sincrono, prima della push): _id.toString()
      // viene chiamato piu' tardi nel controller, quando savedInstances.length
      // sarebbe gia' cambiato per via delle iterazioni successive del batch.
      const index = savedInstances.length;
      const instance: any = {
        ...data,
        _id: { toString: () => `generated-${index}` },
        canTransitionTo: jest.fn().mockReturnValue(true),
      };
      // Mongoose risolve .save() con il documento stesso (gia' dotato di _id):
      // il controller si aspetta savedTask._id, non un booleano.
      instance.save = jest.fn().mockResolvedValue(instance);
      savedInstances.push(instance);
      return instance;
    }) as any;
    mockTaskModelCtor.find = jest.fn();
    mockTaskModelCtor.findOne = jest.fn();

    mockQueueService = { enqueue: jest.fn().mockResolvedValue(undefined), removeTask: jest.fn().mockResolvedValue(undefined) };
    mockOrchestrator = { resolve: jest.fn() };
    mockEventsGateway = { emitTaskUpdated: jest.fn() };
    mockRedis = { set: jest.fn().mockResolvedValue('OK') };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        { provide: getModelToken(Task.name), useValue: mockTaskModelCtor },
        { provide: TaskQueueService, useValue: mockQueueService },
        { provide: OrchestratorService, useValue: mockOrchestrator },
        { provide: EventsGateway, useValue: mockEventsGateway },
        { provide: 'default_IORedisModuleConnectionToken', useValue: mockRedis },
      ],
    }).compile();

    controller = module.get<TaskController>(TaskController);
  });

  describe('getOperations', () => {
    it('dovrebbe restituire l\'elenco statico delle operazioni disponibili', () => {
      const result = controller.getOperations();

      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'SECURITY_OWASP' }),
        expect.objectContaining({ code: 'DOCS_INLINE' }),
        expect.objectContaining({ code: 'CHANGELOG_TECHNICAL' }),
      ]));
    });
  });

  describe('createTasks', () => {
    it('dovrebbe validare ogni operazione tramite l\'Orchestratore (RV.1) prima di creare le task', async () => {
      const dto = { contextId: 'ctx-1', operations: ['SECURITY_OWASP', 'DOCS_INLINE'] } as any;

      await controller.createTasks(dto, 'user-1');

      expect(mockOrchestrator.resolve).toHaveBeenCalledWith('SECURITY_OWASP');
      expect(mockOrchestrator.resolve).toHaveBeenCalledWith('DOCS_INLINE');
    });

    it('dovrebbe creare una task per operazione, condividendo lo stesso batchId, e accodarle tutte', async () => {
      const dto = { contextId: 'ctx-1', operations: ['SECURITY_OWASP', 'DOCS_INLINE'] } as any;

      const result = await controller.createTasks(dto, 'user-1');

      expect(savedInstances).toHaveLength(2);
      expect(savedInstances[0].batchId).toBe(savedInstances[1].batchId);
      expect(savedInstances[0].userId).toBe('user-1');
      expect(savedInstances[0].status).toBe('PENDING');
      expect(mockQueueService.enqueue).toHaveBeenCalledTimes(2);
      expect(result.taskIds).toEqual(['generated-0', 'generated-1']);
      expect(result.batchId).toBe(savedInstances[0].batchId);
    });

    it('non dovrebbe creare alcuna task se l\'orchestratore rifiuta una delle operazioni richieste', async () => {
      mockOrchestrator.resolve.mockImplementation((code: string) => {
        if (code === 'INVALID') throw new NotFoundException('Operazione non supportata: INVALID');
      });
      const dto = { contextId: 'ctx-1', operations: ['INVALID'] } as any;

      await expect(controller.createTasks(dto, 'user-1')).rejects.toThrow(NotFoundException);
      expect(mockQueueService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('getTasks / getTaskById', () => {
    it('getTasks dovrebbe restituire le task dell\'utente ordinate dalla piu\' recente', async () => {
      const chain = { sort: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([{ _id: 't1' }]) };
      mockTaskModelCtor.find.mockReturnValue(chain);

      const result = await controller.getTasks('user-1');

      expect(mockTaskModelCtor.find).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(result).toEqual([{ _id: 't1' }]);
    });

    it('getTaskById dovrebbe lanciare NotFoundException se la task non esiste o non appartiene all\'utente', async () => {
      const chain = { lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(null) };
      mockTaskModelCtor.findOne.mockReturnValue(chain);

      await expect(controller.getTaskById('t1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('getTaskById dovrebbe restituire la task quando trovata per quell\'utente', async () => {
      const chain = { lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue({ _id: 't1', userId: 'user-1' }) };
      mockTaskModelCtor.findOne.mockReturnValue(chain);

      const result = await controller.getTaskById('t1', 'user-1');

      expect(result).toEqual({ _id: 't1', userId: 'user-1' });
    });
  });

  describe('cancelTask - ramo PENDING (rimozione dalla coda prima dell\'avvio)', () => {
    it('dovrebbe rimuovere il job dalla coda BullMQ e transire a CANCELLED', async () => {
      const mockTask = {
        _id: 't1', userId: 'user-1', status: 'PENDING',
        canTransitionTo: jest.fn().mockReturnValue(true),
        save: jest.fn().mockResolvedValue(true),
      };
      mockTaskModelCtor.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockTask) });

      const result = await controller.cancelTask('t1', 'user-1');

      expect(mockQueueService.removeTask).toHaveBeenCalledWith('t1');
      expect(mockTask.status).toBe('CANCELLED');
      expect(mockEventsGateway.emitTaskUpdated).toHaveBeenCalledWith('t1', 'CANCELLED', undefined, 'user-1');
      expect(result).toEqual({ message: 'Task annullata prima dell\'avvio' });
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('cancelTask - task inesistente', () => {
    it('dovrebbe lanciare NotFoundException se la task non appartiene all\'utente o non esiste', async () => {
      mockTaskModelCtor.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(controller.cancelTask('t1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
