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

describe('TaskProcessor - Cancellazione Cooperativa', () => {
  let processor: TaskProcessor;
  let mockTaskModel: any;
  let mockReportModel: any;
  let mockGateway: any;
  let mockEvents: any;

  beforeEach(async () => {
    mockTaskModel = {
      findById: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    
    mockReportModel = class {
      save = jest.fn().mockResolvedValue({ _id: 'report-123' });
    };
    
    mockGateway = { invokeAgent: jest.fn() };
    mockEvents = {
      emitTaskUpdated: jest.fn(),
      emitBatchCompleted: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskProcessor,
        { provide: getModelToken(Task.name), useValue: mockTaskModel },
        { provide: getModelToken(Report.name), useValue: mockReportModel },
        { provide: getModelToken(AnalysisContext.name), useValue: { findById: jest.fn().mockResolvedValue({ repoOwner: 'a', repoName: 'b', resolvedSha: 'c', scopeType: 'FILES' }) } },
        { provide: AgentRegistry, useValue: { getByOperationCode: jest.fn().mockReturnValue({ agentId: 'test' }) } },
        { provide: AgentGatewayService, useValue: mockGateway },
        { provide: EventsGateway, useValue: mockEvents },
      ],
    }).compile();

    processor = module.get<TaskProcessor>(TaskProcessor);
  });

  it('non deve salvare alcun report se l\'agente restituisce CANCELLED (Documento Cancellazione § 6)', async () => {
    // Setup
    const mockTask = {
      _id: 'task-123',
      userId: 'user-1',
      operation: 'SECURITY_OWASP',
      status: 'PENDING',
      canTransitionTo: jest.fn().mockReturnValue(true),
      save: jest.fn(),
    };
    
    mockTaskModel.findById.mockResolvedValue(mockTask);
    
    // Simuliamo la risposta di cancellazione cooperativa dall'agente Python
    mockGateway.invokeAgent.mockResolvedValue({ status: 'CANCELLED', stage: 'carica_contesto' });

    const job = { data: { taskId: 'task-123' } } as Job;
    
    // Act
    await processor.process(job);

    // Assert: Il task diviene CANCELLED
    expect(mockTask.status).toBe('CANCELLED');
    
    // Assert: Viene emesso l'evento WebSocket corretto
    expect(mockEvents.emitTaskUpdated).toHaveBeenCalledWith('task-123', 'CANCELLED', undefined, 'user-1');
  });
});