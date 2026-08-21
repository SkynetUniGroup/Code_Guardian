/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RepositoryContextService } from './repository-context.service.js';
import { OctokitGitHubClient } from './github-client.service.js';
import { CONTEXT_REPOSITORY } from '../domain/repositories/repository.interfaces.js';
import type { CreateContextDto } from '../common/dto/context.dto.js';

describe('RepositoryContextService', () => {
  let service: RepositoryContextService;
  let mockGithubClient: {
    resolveRefToSha: jest.Mock;
    getRepoDetails: jest.Mock;
    getTree: jest.Mock;
  };
  let mockContextRepo: { create: jest.Mock };

  beforeEach(async () => {
    mockGithubClient = {
      resolveRefToSha: jest.fn(),
      getRepoDetails: jest.fn(),
      getTree: jest.fn(),
    };
    mockContextRepo = { create: jest.fn().mockImplementation(async (data) => ({ _id: 'ctx-1', ...data })) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryContextService,
        { provide: OctokitGitHubClient, useValue: mockGithubClient },
        { provide: CONTEXT_REPOSITORY, useValue: mockContextRepo },
      ],
    }).compile();

    service = module.get<RepositoryContextService>(RepositoryContextService);
  });

  const baseDto: CreateContextDto = {
    repoOwner: 'acme', repoName: 'demo', ref: 'main', scopeType: 'FULL_REPOSITORY',
  } as CreateContextDto;

  function mockSuccessfulGithubMetadata(isPrivate = true) {
    mockGithubClient.resolveRefToSha.mockResolvedValue('resolved-sha-123');
    mockGithubClient.getRepoDetails.mockResolvedValue({ private: isPrivate });
  }

  it('dovrebbe essere definito', () => {
    expect(service).toBeDefined();
  });

  describe('traduzione degli errori GitHub in eccezioni HTTP significative', () => {
    it('dovrebbe lanciare NotFoundException se il repository o il ref non esistono (404)', async () => {
      mockGithubClient.resolveRefToSha.mockRejectedValue({ status: 404 });

      await expect(service.buildContext('user-1', baseDto)).rejects.toThrow(NotFoundException);
    });

    it('dovrebbe lanciare BadRequestException per un token non valido/non autorizzato (401/403)', async () => {
      mockGithubClient.resolveRefToSha.mockRejectedValue({ status: 401 });

      await expect(service.buildContext('user-1', baseDto)).rejects.toThrow(BadRequestException);
    });

    it('dovrebbe propagare inalterato qualsiasi altro errore GitHub non gestito esplicitamente', async () => {
      const unexpected = { status: 500, message: 'GitHub down' };
      mockGithubClient.resolveRefToSha.mockRejectedValue(unexpected);

      await expect(service.buildContext('user-1', baseDto)).rejects.toBe(unexpected);
    });
  });

  describe('costruzione dell\'ambito (scope) e validazioni', () => {
    it('dovrebbe costruire il contesto con successo per FULL_REPOSITORY rilevando i linguaggi supportati', async () => {
      mockSuccessfulGithubMetadata(true);
      mockGithubClient.getTree.mockResolvedValue([
        { path: 'src/a.ts', type: 'file' },
        { path: 'src/b.py', type: 'file' },
        { path: 'README.md', type: 'file' },
        { path: 'src', type: 'dir' },
      ]);

      const result = await service.buildContext('user-1', baseDto);

      expect(mockContextRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        repoOwner: 'acme',
        repoName: 'demo',
        isPrivate: true,
        resolvedSha: 'resolved-sha-123',
        detectedLanguages: expect.arrayContaining(['ts', 'py']),
        estimatedFileCount: 3, // a.ts, b.py, README.md (le dir sono escluse)
      }));
      expect((result as any)._id).toBe('ctx-1');
    });

    it('dovrebbe richiedere almeno un path quando lo scope non e\' FULL_REPOSITORY', async () => {
      mockSuccessfulGithubMetadata();
      mockGithubClient.getTree.mockResolvedValue([{ path: 'src/a.ts', type: 'file' }]);

      const dto = { ...baseDto, scopeType: 'FILES', paths: [] } as CreateContextDto;

      await expect(service.buildContext('user-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('dovrebbe filtrare i file per i path forniti quando lo scope e\' FILES/DIRECTORIES', async () => {
      mockSuccessfulGithubMetadata();
      mockGithubClient.getTree.mockResolvedValue([
        { path: 'src/a.ts', type: 'file' },
        { path: 'vendor/b.ts', type: 'file' },
      ]);
      const dto = { ...baseDto, scopeType: 'DIRECTORIES', paths: ['src/'] } as CreateContextDto;

      await service.buildContext('user-1', dto);

      expect(mockContextRepo.create).toHaveBeenCalledWith(expect.objectContaining({ estimatedFileCount: 1 }));
    });

    it('dovrebbe lanciare BadRequestException se nessun linguaggio supportato viene rilevato nell\'ambito', async () => {
      mockSuccessfulGithubMetadata();
      mockGithubClient.getTree.mockResolvedValue([{ path: 'README.md', type: 'file' }]);

      await expect(service.buildContext('user-1', baseDto)).rejects.toThrow(BadRequestException);
      await expect(service.buildContext('user-1', baseDto)).rejects.toThrow(/Nessun linguaggio supportato/);
    });

    it('dovrebbe lanciare BadRequestException se l\'ambito e\' vuoto (0 file)', async () => {
      mockSuccessfulGithubMetadata();
      mockGithubClient.getTree.mockResolvedValue([]);

      await expect(service.buildContext('user-1', baseDto)).rejects.toThrow(/vuoto o non contiene file/);
    });

    it('dovrebbe lanciare BadRequestException se il numero di file supera il limite RF.31 (100)', async () => {
      mockSuccessfulGithubMetadata();
      const manyFiles = Array.from({ length: 101 }, (_, i) => ({ path: `src/file${i}.ts`, type: 'file' }));
      mockGithubClient.getTree.mockResolvedValue(manyFiles);

      await expect(service.buildContext('user-1', baseDto)).rejects.toThrow(/superando il limite di 100/);
    });

    it('dovrebbe accettare esattamente il limite massimo di 100 file senza lanciare errori', async () => {
      mockSuccessfulGithubMetadata();
      const exactlyMax = Array.from({ length: 100 }, (_, i) => ({ path: `src/file${i}.ts`, type: 'file' }));
      mockGithubClient.getTree.mockResolvedValue(exactlyMax);

      await expect(service.buildContext('user-1', baseDto)).resolves.toBeDefined();
    });
  });
});
