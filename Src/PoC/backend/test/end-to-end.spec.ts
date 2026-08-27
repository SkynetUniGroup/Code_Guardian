/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { OctokitGitHubClient } from '../src/internal/github-client.service.js';
import { AgentGatewayService } from '../src/orchestration/agent-gateway.service.js';
import { TaskQueueService } from '../src/orchestration/task-queue.service.js';
import { TaskProcessor } from '../src/orchestration/task.processor.js';
import { getModelToken } from '@nestjs/mongoose';
import { Task } from '../src/domain/schemas/task.schema.js';
import { Report } from '../src/domain/schemas/report.schema.js';

describe('Flusso End-to-End (E2E) - Code Guardian (Vincolo di Validazione § 12)', () => {
  let app: INestApplication;
  let taskProcessor: TaskProcessor;
  let taskModel: any;
  let reportModel: any;

  // Dati di test
  const testUserId = 'user-123';
  let contextId: string;
  let taskId: string;
  let reportId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // 1. Mock dell'autenticazione JWT per simulare il frontend
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context) => {
          const req = context.switchToHttp().getRequest();
          req.user = { userId: testUserId }; // Iniettiamo l'utente per @CurrentUser()
          return true;
        },
      })
      // 2. Mock di GitHub (Facade finta come da specifiche)
      .overrideProvider(OctokitGitHubClient)
      .useValue({
        resolveRefToSha: jest.fn().mockResolvedValue('fake-sha-123'),
        getRepoDetails: jest.fn().mockResolvedValue({ private: true }),
        getTree: jest.fn().mockResolvedValue([
          { path: 'src/main.ts', type: 'file' },
          { path: 'package.json', type: 'file' }
        ]),
      })
      // 3. Mock dell'agente Python per restituire un report di successo
      .overrideProvider(AgentGatewayService)
      .useValue({
        invokeAgent: jest.fn().mockResolvedValue({
          agentId: 'security',
          operation: 'SECURITY_OWASP',
          status: 'COMPLETED',
          summary: 'Scansione E2E completata',
          durationMs: 1200,
          tokensConsumed: 450,
          body: [
            {
              kind: 'finding',
              order: 0,
              owaspCategory: 'A01',
              severity: 'high',
              filePath: 'src/main.ts',
              startLine: 1,
              endLine: 2,
              explanation: 'Test vulnerabilità E2E',
              remediation: 'Risolvere E2E',
            }
          ],
        }),
      })
      // 4. Mock della coda BullMQ: invece di accodare su Redis, catturiamo il task
      .overrideProvider(TaskQueueService)
      .useValue({
        enqueue: jest.fn().mockImplementation(async (task) => {
          // Salviamo il taskId generato per processarlo manualmente nel test
          taskId = task._id.toString();
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    // Impostiamo il prefisso globale per coerenza con main.ts
    app.setGlobalPrefix('api/v1');
    await app.init();

    taskProcessor = moduleFixture.get<TaskProcessor>(TaskProcessor);
    taskModel = moduleFixture.get(getModelToken(Task.name));
    reportModel = moduleFixture.get(getModelToken(Report.name));
  });

  afterAll(async () => {
    await app.close();
  });

  it('Step 1: Creazione dell\'Analysis Context (POST /contexts)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/contexts')
      .send({
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        ref: 'main',
        scopeType: 'FULL_REPOSITORY',
      })
      .expect(201);

    expect(res.body.contextId).toBeDefined();
    contextId = res.body.contextId;
  });

  it('Step 2: Avvio delle Task (POST /tasks) - L\'orchestratore instrada l\'agente', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .send({
        contextId: contextId,
        operations: ['SECURITY_OWASP'],
      })
      .expect(202);

    expect(res.body.taskIds).toBeInstanceOf(Array);
    expect(res.body.taskIds.length).toBe(1);
    
    // Il mock della coda ha catturato l'ID del task
    expect(taskId).toBeDefined();
  });

  it('Step 3: Il TaskProcessor elabora il job e salva il Report su MongoDB', async () => {
    // Verifichiamo che il task sia PENDING prima dell'esecuzione
    const pendingTask = await taskModel.findById(taskId);
    expect(pendingTask.status).toBe('PENDING');

    // Eseguiamo manualmente il processor per simulare il consumo dalla coda BullMQ
    await taskProcessor.process({ data: { taskId } } as any);

    // Verifichiamo lo stato finale su DB
    const completedTask = await taskModel.findById(taskId);
    expect(completedTask.status).toBe('COMPLETED');
    expect(completedTask.reportId).toBeDefined();
    
    reportId = completedTask.reportId.toString();
  });

  it('Step 4: Recupero del Report restituito nel formato atteso (GET /reports/:id)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/reports/${reportId}`)
      .expect(200);

    const report = res.body;
    expect(report.status).toBe('COMPLETED');
    expect(report.operation).toBe('SECURITY_OWASP');
    expect(report.summary).toBe('Scansione E2E completata');
    
    // Verifica dei blocchi polimorfi
    expect(report.body).toBeInstanceOf(Array);
    expect(report.body[0].kind).toBe('finding');
    expect(report.body[0].severity).toBe('high');
  });
});