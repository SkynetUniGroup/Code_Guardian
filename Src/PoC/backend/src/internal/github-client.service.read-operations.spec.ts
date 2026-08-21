/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { Octokit } from 'octokit';
import { OctokitGitHubClient } from './github-client.service.js';
import { CredentialVaultService } from './credential-vault.service.js';
import { ACCESS_LOG_REPOSITORY } from '../domain/repositories/repository.interfaces.js';

/**
 * Completa la copertura di github-client.service.ts oltre a quanto gia'
 * verificato in github-client.service.spec.ts (whitelist degli endpoint e
 * AccessLog): cache Redis dei file, mapping delle issue, risoluzione dei
 * ref, riutilizzo dell'istanza Octokit in cache e rallentamento su rate
 * limit in esaurimento.
 */
describe('OctokitGitHubClient - operazioni di lettura', () => {
  let service: OctokitGitHubClient;
  let mockVaultService: { getDecryptedToken: jest.Mock };
  let mockRedis: { get: jest.Mock; set: jest.Mock };
  let mockAccessLogRepo: { logAccess: jest.Mock };

  beforeEach(async () => {
    mockVaultService = { getDecryptedToken: jest.fn().mockResolvedValue('fake-github-token') };
    mockRedis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };
    mockAccessLogRepo = { logAccess: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OctokitGitHubClient,
        { provide: CredentialVaultService, useValue: mockVaultService },
        { provide: ACCESS_LOG_REPOSITORY, useValue: mockAccessLogRepo },
        { provide: 'default_IORedisModuleConnectionToken', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<OctokitGitHubClient>(OctokitGitHubClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('getFileContent (cache Redis)', () => {
    it('dovrebbe restituire il valore in cache senza contattare GitHub se presente su Redis', async () => {
      const cached = { path: 'src/a.ts', content: 'export const x = 1;', sha: 'sha-file', language: 'typescript' };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));
      const requestSpy = jest.spyOn(Octokit.prototype, 'request');

      const result = await service.getFileContent('t1', 'user-1', 'acme', 'demo', 'sha1', 'src/a.ts');

      expect(result).toEqual(cached);
      expect(requestSpy).not.toHaveBeenCalled();
    });

    it('dovrebbe decodificare il Base64, rilevare il linguaggio TypeScript e popolare la cache con TTL 86400s', async () => {
      const base64Content = Buffer.from('export const x = 1;', 'utf8').toString('base64');
      jest.spyOn(Octokit.prototype, 'request').mockResolvedValue({
        headers: { 'x-ratelimit-remaining': '80' },
        data: { path: 'src/a.ts', content: base64Content, sha: 'file-sha' },
      } as any);

      const result = await service.getFileContent('t1', 'user-1', 'acme', 'demo', 'sha1', 'src/a.ts');

      expect(result).toEqual({ path: 'src/a.ts', content: 'export const x = 1;', sha: 'file-sha', language: 'typescript' });
      expect(mockRedis.set).toHaveBeenCalledWith(
        'demo@sha1:src/a.ts',
        JSON.stringify(result),
        'EX',
        86400,
      );
    });

    it.each([
      ['src/a.py', 'python'],
      ['src/a.js', 'javascript'],
      ['src/a.txt', 'unknown'],
    ])('dovrebbe rilevare il linguaggio corretto per l\'estensione di %s -> %s', async (path, expectedLanguage) => {
      const base64Content = Buffer.from('contenuto', 'utf8').toString('base64');
      jest.spyOn(Octokit.prototype, 'request').mockResolvedValue({
        headers: { 'x-ratelimit-remaining': '80' },
        data: { path, content: base64Content, sha: 'sha' },
      } as any);

      const result = await service.getFileContent('t1', 'user-1', 'acme', 'demo', 'sha1', path);

      expect(result.language).toBe(expectedLanguage);
    });
  });

  describe('listIssues', () => {
    it('dovrebbe mappare i campi delle issue, unendo le label ed esporre hasSufficientMetadata', async () => {
      jest.spyOn(Octokit.prototype, 'request').mockResolvedValue({
        headers: { 'x-ratelimit-remaining': '80' },
        data: [
          {
            number: 1, title: 'Bug critico', state: 'closed',
            labels: [{ name: 'bug' }, { name: 'urgent' }],
            milestone: { title: 'Sprint 5' },
            closed_at: '2026-01-01',
            body: 'x'.repeat(60),
          },
          {
            number: 2, title: 'Descrizione povera', state: 'closed',
            labels: [], milestone: null, closed_at: null, body: 'troppo corto',
          },
        ],
      } as any);

      const result = await service.listIssues('t1', 'user-1', 'acme', 'demo', { state: 'closed' });

      expect(result[0]).toEqual({
        number: 1, title: 'Bug critico', state: 'closed', labels: 'bug,urgent',
        milestone: 'Sprint 5', closedAt: '2026-01-01', hasSufficientMetadata: true,
      });
      expect(result[1].milestone).toBeNull();
      expect(result[1].hasSufficientMetadata).toBe(false); // corpo troppo corto (<=50 caratteri)
    });

    it('dovrebbe usare "all" come stato di default quando il filtro non specifica lo stato', async () => {
      const requestSpy = jest.spyOn(Octokit.prototype, 'request').mockResolvedValue({
        headers: { 'x-ratelimit-remaining': '80' }, data: [],
      } as any);

      await service.listIssues('t1', 'user-1', 'acme', 'demo', undefined);

      expect(requestSpy).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}/issues',
        expect.objectContaining({ state: 'all' }),
      );
    });
  });

  describe('listRefs', () => {
    it('dovrebbe mappare branch e tag nel formato {name, sha}', async () => {
      jest.spyOn(Octokit.prototype, 'request').mockImplementation(async (endpoint: any) => {
        if (endpoint === 'GET /repos/{owner}/{repo}/branches') {
          return { headers: { 'x-ratelimit-remaining': '80' }, data: [{ name: 'main', commit: { sha: 'sha-main' } }] } as any;
        }
        return { headers: { 'x-ratelimit-remaining': '80' }, data: [{ name: 'v1.0', commit: { sha: 'sha-tag' } }] } as any;
      });

      const result = await service.listRefs('user-1', 'acme', 'demo');

      expect(result).toEqual({
        branches: [{ name: 'main', sha: 'sha-main' }],
        tags: [{ name: 'v1.0', sha: 'sha-tag' }],
      });
    });
  });

  describe('resolveRefToSha', () => {
    it('dovrebbe restituire lo sha risolto dal commit', async () => {
      jest.spyOn(Octokit.prototype, 'request').mockResolvedValue({
        headers: { 'x-ratelimit-remaining': '80' }, data: { sha: 'sha-risolto' },
      } as any);

      const sha = await service.resolveRefToSha('user-1', 'acme', 'demo', 'main');

      expect(sha).toBe('sha-risolto');
    });
  });

  describe('cache dell\'istanza Octokit per utente (TTL 60s)', () => {
    it('dovrebbe riutilizzare la stessa istanza Octokit per richieste consecutive dello stesso utente, evitando di ricontattare il vault', async () => {
      jest.spyOn(Octokit.prototype, 'request').mockResolvedValue({
        headers: { 'x-ratelimit-remaining': '80' }, data: { sha: 'sha-x' },
      } as any);

      await service.resolveRefToSha('user-1', 'acme', 'demo', 'main');
      await service.resolveRefToSha('user-1', 'acme', 'demo', 'develop');

      expect(mockVaultService.getDecryptedToken).toHaveBeenCalledTimes(1);
    });

    it('dovrebbe recuperare un nuovo token dal vault per un utente diverso', async () => {
      jest.spyOn(Octokit.prototype, 'request').mockResolvedValue({
        headers: { 'x-ratelimit-remaining': '80' }, data: { sha: 'sha-x' },
      } as any);

      await service.resolveRefToSha('user-1', 'acme', 'demo', 'main');
      await service.resolveRefToSha('user-2', 'acme', 'demo', 'main');

      expect(mockVaultService.getDecryptedToken).toHaveBeenCalledTimes(2);
    });
  });

  describe('rallentamento su rate limit in esaurimento', () => {
    it('dovrebbe attendere ~2s se il rate limit rimanente e\' inferiore a 10, senza far fallire la richiesta', async () => {
      jest.useFakeTimers();
      jest.spyOn(Octokit.prototype, 'request').mockResolvedValue({
        headers: { 'x-ratelimit-remaining': '3' }, data: { sha: 'sha-limitato' },
      } as any);

      const resultPromise = service.resolveRefToSha('user-1', 'acme', 'demo', 'main');
      await jest.advanceTimersByTimeAsync(2000);
      const sha = await resultPromise;

      expect(sha).toBe('sha-limitato');
    });
  });
});
