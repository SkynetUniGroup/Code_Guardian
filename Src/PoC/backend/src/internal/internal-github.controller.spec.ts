/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { InternalGitHubController } from './internal-github.controller.js';
import { OctokitGitHubClient } from './github-client.service.js';
import { EventsGateway } from '../public/events.gateway.js';
import { Task } from '../domain/schemas/task.schema.js';
import { HmacGuard } from '../common/guards/hmac.guard.js';

describe('InternalGitHubController', () => {
  let controller: InternalGitHubController;
  let mockGithubClient: { getTree: jest.Mock; getFileContent: jest.Mock; listIssues: jest.Mock };
  let mockEventsGateway: { emitTaskProgress: jest.Mock };
  let mockTaskModel: { findByIdAndUpdate: jest.Mock };

  beforeEach(async () => {
    mockGithubClient = {
      getTree: jest.fn(),
      getFileContent: jest.fn(),
      listIssues: jest.fn(),
    };
    mockEventsGateway = { emitTaskProgress: jest.fn() };
    mockTaskModel = { findByIdAndUpdate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InternalGitHubController],
      providers: [
        { provide: OctokitGitHubClient, useValue: mockGithubClient },
        { provide: EventsGateway, useValue: mockEventsGateway },
        { provide: getModelToken(Task.name), useValue: mockTaskModel },
      ],
    })
      // La rotta e' protetta da HmacGuard (Appendice C): lo bypassiamo qui,
      // essendo gia' testato in isolamento in hmac.guard.spec.ts
      .overrideGuard(HmacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<InternalGitHubController>(InternalGitHubController);
  });

  it('dovrebbe essere definito', () => {
    expect(controller).toBeDefined();
  });

  describe('readTree', () => {
    it('dovrebbe restituire i nodi avvolti nella chiave "nodes"', async () => {
      const nodes = [{ path: 'src/a.ts', type: 'file', sizeBytes: 10 }];
      mockGithubClient.getTree.mockResolvedValue(nodes);

      const result = await controller.readTree({
        taskId: 't1', userId: 'u1', owner: 'acme', repo: 'demo', sha: 'sha1',
      });

      expect(result).toEqual({ nodes });
      expect(mockGithubClient.getTree).toHaveBeenCalledWith('t1', 'u1', 'acme', 'demo', 'sha1');
    });
  });

  describe('readFile', () => {
    it('dovrebbe restituire il contenuto del file in caso di successo', async () => {
      const fileResult = { path: 'src/a.ts', content: 'const x = 1;', sha: 'filesha', language: 'typescript' };
      mockGithubClient.getFileContent.mockResolvedValue(fileResult);

      const result = await controller.readFile({
        taskId: 't1', userId: 'u1', owner: 'acme', repo: 'demo', sha: 'sha1', path: 'src/a.ts',
      });

      expect(result).toEqual(fileResult);
    });

    it('dovrebbe convertire qualunque errore del client GitHub in NotFoundException con il path richiesto', async () => {
      mockGithubClient.getFileContent.mockRejectedValue(new Error('404 dal upstream'));

      await expect(
        controller.readFile({ taskId: 't1', userId: 'u1', owner: 'acme', repo: 'demo', sha: 'sha1', path: 'missing.ts' }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        controller.readFile({ taskId: 't1', userId: 'u1', owner: 'acme', repo: 'demo', sha: 'sha1', path: 'missing.ts' }),
      ).rejects.toThrow(/missing\.ts/);
    });
  });

  describe('readIssues', () => {
    it('dovrebbe restituire le issue avvolte nella chiave "issues"', async () => {
      const issues = [{ number: 1, title: 'Bug', state: 'closed' }];
      mockGithubClient.listIssues.mockResolvedValue(issues);

      const result = await controller.readIssues({ taskId: 't1', userId: 'u1', owner: 'acme', repo: 'demo' });

      expect(result).toEqual({ issues });
    });
  });

  describe('updateProgress', () => {
    function mockUpdateResult(doc: any) {
      mockTaskModel.findByIdAndUpdate.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(doc) }),
      });
    }

    it('dovrebbe aggiornare il documento e inoltrare l\'evento con lo userId della task trovata', async () => {
      mockUpdateResult({ userId: 'user-owner' });

      await controller.updateProgress({ stage: 'invoca_llm', percent: 55 }, 'task-1');

      expect(mockTaskModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'task-1',
        { $set: { progressPercent: 55, currentStage: 'invoca_llm' } },
        { new: true, select: 'userId' },
      );
      expect(mockEventsGateway.emitTaskProgress).toHaveBeenCalledWith('task-1', 'invoca_llm', 55, 'user-owner');
    });

    it('dovrebbe inoltrare comunque l\'evento con userId undefined se la task non viene trovata', async () => {
      mockUpdateResult(null);

      const result = await controller.updateProgress({ stage: 'x', percent: 10 }, 'task-inesistente');

      expect(mockEventsGateway.emitTaskProgress).toHaveBeenCalledWith('task-inesistente', 'x', 10, undefined);
      expect(result).toBeUndefined();
    });
  });
});
