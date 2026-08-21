/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { RepositoriesController } from './repositories.controller.js';
import { OctokitGitHubClient } from '../internal/github-client.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

describe('RepositoriesController', () => {
  let controller: RepositoriesController;
  let mockGithubClient: {
    listRepositories: jest.Mock;
    listRefs: jest.Mock;
    resolveRefToSha: jest.Mock;
    getTree: jest.Mock;
  };

  beforeEach(async () => {
    mockGithubClient = {
      listRepositories: jest.fn(),
      listRefs: jest.fn(),
      resolveRefToSha: jest.fn(),
      getTree: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RepositoriesController],
      providers: [{ provide: OctokitGitHubClient, useValue: mockGithubClient }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RepositoriesController>(RepositoriesController);
  });

  describe('getRepositories', () => {
    it('dovrebbe mappare i repository GitHub nel formato pubblico atteso', async () => {
      mockGithubClient.listRepositories.mockResolvedValue([
        { owner: { login: 'acme' }, name: 'demo', private: true, default_branch: 'main', language: 'TypeScript' },
      ]);

      const result = await controller.getRepositories('user-1');

      expect(result).toEqual([
        { owner: 'acme', name: 'demo', isPrivate: true, defaultBranch: 'main', primaryLanguage: 'TypeScript' },
      ]);
    });
  });

  describe('getRefs', () => {
    it('dovrebbe delegare direttamente al client GitHub', async () => {
      const refs = { branches: [{ name: 'main', sha: 's1' }], tags: [] };
      mockGithubClient.listRefs.mockResolvedValue(refs);

      const result = await controller.getRefs('user-1', 'acme', 'demo');

      expect(mockGithubClient.listRefs).toHaveBeenCalledWith('user-1', 'acme', 'demo');
      expect(result).toBe(refs);
    });
  });

  describe('getTree', () => {
    it('dovrebbe prima risolvere il ref in sha, poi richiedere l\'albero con quello sha risolto', async () => {
      mockGithubClient.resolveRefToSha.mockResolvedValue('sha-risolto');
      mockGithubClient.getTree.mockResolvedValue([{ path: 'a.ts', type: 'file' }]);

      const result = await controller.getTree('user-1', 'acme', 'demo', 'main');

      expect(mockGithubClient.resolveRefToSha).toHaveBeenCalledWith('user-1', 'acme', 'demo', 'main');
      expect(mockGithubClient.getTree).toHaveBeenCalledWith(null, 'user-1', 'acme', 'demo', 'sha-risolto');
      expect(result).toEqual([{ path: 'a.ts', type: 'file' }]);
    });
  });
});
