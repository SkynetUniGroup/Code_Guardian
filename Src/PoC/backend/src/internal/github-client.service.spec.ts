/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { OctokitGitHubClient } from './github-client.service.js';
import { CredentialVaultService } from './credential-vault.service.js';
import { ACCESS_LOG_REPOSITORY } from '../domain/repositories/repository.interfaces.js';

describe('OctokitGitHubClient', () => {
  let service: OctokitGitHubClient;
  let mockAccessLogRepo: any;
  let mockVaultService: any;
  let mockRedis: any;

  beforeEach(async () => {
    mockAccessLogRepo = {
      logAccess: jest.fn().mockResolvedValue(true),
    };

    mockVaultService = {
      getDecryptedToken: jest.fn().mockResolvedValue('fake-github-token'),
    };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OctokitGitHubClient,
        { provide: CredentialVaultService, useValue: mockVaultService },
        { provide: ACCESS_LOG_REPOSITORY, useValue: mockAccessLogRepo },
        // Utilizziamo direttamente il token stringa per bypassare l'errore TS nodenext
        { provide: 'default_IORedisModuleConnectionToken', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<OctokitGitHubClient>(OctokitGitHubClient);
  });

  it('dovrebbe essere definito', () => {
    expect(service).toBeDefined();
  });

  it('dovrebbe bloccare le richieste a endpoint NON in whitelist per garantire il vincolo RS.3', async () => {
    // Act & Assert
    // Utilizziamo un cast (any) per testare il metodo privato executeSafely e forzare un endpoint malevolo
    await expect(
      (service as any).executeSafely('task-123', 'user-1', 'POST /repos/{owner}/{repo}/issues', { owner: 'a', repo: 'b' })
    ).rejects.toThrow('Endpoint non in whitelist: POST /repos/{owner}/{repo}/issues');
    
    // L'AccessLog non deve essere chiamato se la whitelist blocca
    expect(mockAccessLogRepo.logAccess).not.toHaveBeenCalled();
  });

  it('dovrebbe registrare l\'accesso nell\'AccessLog per le richieste valide (Garanzia RS.3)', async () => {
    // Effettuiamo il mock completo di Octokit per evitare di chiamare le vere API
    const mockOctokitRequest = jest.fn().mockResolvedValue({ headers: { 'x-ratelimit-remaining': '99' }, data: { tree: [] } });
    (service as any).getOctokit = jest.fn().mockResolvedValue({ request: mockOctokitRequest });

    // Act - Eseguiamo una lettura valida presente in whitelist
    await service.getTree('task-123', 'user-1', 'test-owner', 'test-repo', 'sha-123');

    // Assert
    expect(mockAccessLogRepo.logAccess).toHaveBeenCalledTimes(1);
    expect(mockAccessLogRepo.logAccess).toHaveBeenCalledWith(
      'task-123',
      'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
      'test-owner/test-repo'
    );
  });
});