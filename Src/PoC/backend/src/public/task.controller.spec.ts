/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { TaskController } from './task.controller.js';
import { getModelToken } from '@nestjs/mongoose';
import { Task } from '../domain/schemas/task.schema.js';
import { TaskQueueService } from '../orchestration/task-queue.service.js';
import { OrchestratorService } from '../orchestration/orchestrator.service.js';
import { EventsGateway } from './events.gateway.js';

describe('TaskController - Cancellazione Cooperativa', () => {
  let controller: TaskController;
  let mockTaskModel: any;
  let mockRedis: any;

  beforeEach(async () => {
    mockTaskModel = {
      findOne: jest.fn(),
    };
    
    // Mock di Redis
    mockRedis = {
      set: jest.fn().mockResolvedValue('OK'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        { provide: getModelToken(Task.name), useValue: mockTaskModel },
        { provide: TaskQueueService, useValue: {} },
        { provide: OrchestratorService, useValue: {} },
        { provide: EventsGateway, useValue: { emitTaskUpdated: jest.fn() } },
        { provide: 'default_IORedisModuleConnectionToken', useValue: mockRedis },
      ],
    }).compile();

    controller = module.get<TaskController>(TaskController);
  });

  it('dovrebbe scrivere su Redis il flag di cancellazione con TTL 120s se la task è RUNNING (Documento Cancellazione § 3.1, 3.2)', async () => {
    // Setup task simulata
    const mockTask = {
      _id: 'task-123',
      userId: 'user-1',
      status: 'RUNNING',
      canTransitionTo: jest.fn().mockReturnValue(true),
      save: jest.fn().mockResolvedValue(true),
    };
    mockTaskModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockTask) });

    // Act
    const result = await controller.cancelTask('task-123', 'user-1');

    // Assert: verifica la firma corretta su Redis
    expect(mockRedis.set).toHaveBeenCalledWith('cancel:task:task-123', '1', 'EX', 120);
    expect(result).toEqual({ message: 'Annullamento richiesto, in attesa dell\'agente' });
  });

  it('dovrebbe ignorare la cancellazione se la task è in stato terminale (Documento Cancellazione § 6)', async () => {
    // Setup task simulata terminale (es. COMPLETED)
    const mockTask = {
      _id: 'task-123',
      userId: 'user-1',
      status: 'COMPLETED',
      canTransitionTo: jest.fn().mockReturnValue(false),
    };
    mockTaskModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockTask) });

    // Act
    const result = await controller.cancelTask('task-123', 'user-1');

    // Assert: la funzione deve restituire il messaggio senza toccare Redis
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(result).toEqual({ message: 'Cancellazione ignorata: la task è già in stato COMPLETED' });
  });
});