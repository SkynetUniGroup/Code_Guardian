/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Octokit } from 'octokit';
import { CredentialVaultService } from './credential-vault.service.js';
import { CREDENTIAL_REPOSITORY } from '../domain/repositories/repository.interfaces.js';

// TU_07 (PdQ) — RS.2: round trip di cifratura/decifratura reale (AES-256-GCM) dei
// token delle credenziali utente; il testo cifrato persistito non deve mai contenere
// il segreto in chiaro.
describe('CredentialVaultService', () => {
  let service: CredentialVaultService;
  let mockRepo: {
    upsertCredential: jest.Mock;
    findByUserIdAndProvider: jest.Mock;
    findAllByUserId: jest.Mock;
    findById: jest.Mock;
    deleteById: jest.Mock;
  };
  let mockConfigService: { get: jest.Mock };

  beforeEach(async () => {
    mockRepo = {
      upsertCredential: jest.fn().mockResolvedValue(undefined),
      findByUserIdAndProvider: jest.fn(),
      findAllByUserId: jest.fn(),
      findById: jest.fn(),
      deleteById: jest.fn(),
    };
    mockConfigService = { get: jest.fn().mockReturnValue('a-very-secret-master-key') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialVaultService,
        { provide: CREDENTIAL_REPOSITORY, useValue: mockRepo },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CredentialVaultService>(CredentialVaultService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('dovrebbe essere definito', () => {
    expect(service).toBeDefined();
  });

  describe('saveToken / getDecryptedToken (round trip di cifratura reale AES-256-GCM)', () => {
    it('dovrebbe cifrare il token e delegarne il salvataggio al repository, con salt/iv/authTag distinti a ogni chiamata', async () => {
      await service.saveToken('user-1', 'GITHUB', 'ghp_segreto123');

      expect(mockRepo.upsertCredential).toHaveBeenCalledTimes(1);
      const [userId, provider, payload] = mockRepo.upsertCredential.mock.calls[0];
      expect(userId).toBe('user-1');
      expect(provider).toBe('GITHUB');
      expect(payload.ciphertext).toEqual(expect.any(String));
      expect(payload.iv).toEqual(expect.any(String));
      expect(payload.authTag).toEqual(expect.any(String));
      expect(payload.salt).toEqual(expect.any(String));
      // Il testo cifrato non deve mai contenere il segreto in chiaro
      expect(payload.ciphertext).not.toContain('ghp_segreto123');
    });

    it('dovrebbe lanciare un errore se CREDENTIAL_MASTER_KEY non e\' configurata', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await expect(service.saveToken('user-1', 'GITHUB', 'token')).rejects.toThrow(
        'CREDENTIAL_MASTER_KEY non configurata',
      );
    });

    it('dovrebbe decifrare correttamente un token salvato in precedenza (round trip)', async () => {
      let stored: any;
      mockRepo.upsertCredential.mockImplementation(async (_userId, _provider, data) => {
        stored = data;
      });
      mockRepo.findByUserIdAndProvider.mockImplementation(async () => stored);

      await service.saveToken('user-1', 'GITHUB', 'ghp_super_segreto_reale');
      const decrypted = await service.getDecryptedToken('user-1', 'GITHUB');

      expect(decrypted).toBe('ghp_super_segreto_reale');
    });

    it('dovrebbe lanciare NotFoundException se nessuna credenziale e\' configurata per l\'utente/provider', async () => {
      mockRepo.findByUserIdAndProvider.mockResolvedValue(null);

      await expect(service.getDecryptedToken('user-1', 'GITHUB')).rejects.toThrow(NotFoundException);
    });

    it('getDecryptedToken dovrebbe usare GITHUB come provider di default', async () => {
      mockRepo.findByUserIdAndProvider.mockResolvedValue(null);

      await expect(service.getDecryptedToken('user-1')).rejects.toThrow(NotFoundException);
      expect(mockRepo.findByUserIdAndProvider).toHaveBeenCalledWith('user-1', 'GITHUB');
    });
  });

  describe('listCredentials', () => {
    it('dovrebbe mappare i documenti del repository nel formato pubblico atteso (senza esporre il segreto)', async () => {
      mockRepo.findAllByUserId.mockResolvedValue([
        { _id: { toString: () => 'cred-1' }, provider: 'GITHUB', createdAt: '2026-01-01', ciphertext: 'x' },
      ]);

      const result = await service.listCredentials('user-1');

      expect(result).toEqual([
        { id: 'cred-1', provider: 'GITHUB', configured: true, createdAt: '2026-01-01' },
      ]);
      // Nessun campo sensibile (ciphertext/iv/authTag/salt) nel risultato esposto
      expect(result[0]).not.toHaveProperty('ciphertext');
    });
  });

  describe('validateToken', () => {
    it('dovrebbe lanciare NotFoundException se la credenziale non esiste', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.validateToken('user-1', 'cred-1')).rejects.toThrow(NotFoundException);
    });

    it('dovrebbe restituire valid:true e gli scope dichiarati da GitHub se il token e\' valido', async () => {
      let stored: any;
      mockRepo.upsertCredential.mockImplementation(async (_u, _p, data) => { stored = data; });
      mockRepo.findByUserIdAndProvider.mockImplementation(async () => stored);
      await service.saveToken('user-1', 'GITHUB', 'ghp_valido');
      mockRepo.findById.mockResolvedValue(stored);

      jest.spyOn(Octokit.prototype, 'request').mockResolvedValue({
        headers: { 'x-oauth-scopes': 'repo, read:user' },
        data: {},
      } as any);

      const result = await service.validateToken('user-1', 'cred-1');

      expect(result).toEqual({ valid: true, scopes: ['repo', 'read:user'] });
    });

    it('dovrebbe restituire valid:false quando GitHub rifiuta il token (401/403 o rete)', async () => {
      let stored: any;
      mockRepo.upsertCredential.mockImplementation(async (_u, _p, data) => { stored = data; });
      mockRepo.findByUserIdAndProvider.mockImplementation(async () => stored);
      await service.saveToken('user-1', 'GITHUB', 'ghp_scaduto');
      mockRepo.findById.mockResolvedValue(stored);

      jest.spyOn(Octokit.prototype, 'request').mockRejectedValue(new Error('Bad credentials'));

      const result = await service.validateToken('user-1', 'cred-1');

      expect(result).toEqual({ valid: false, scopes: [] });
    });
  });

  describe('revokeCredential', () => {
    it('dovrebbe lanciare NotFoundException se il repository segnala che nulla e\' stato eliminato', async () => {
      mockRepo.deleteById.mockResolvedValue(false);

      await expect(service.revokeCredential('user-1', 'cred-1')).rejects.toThrow(NotFoundException);
    });

    it('dovrebbe completare senza errori quando la credenziale viene eliminata con successo', async () => {
      mockRepo.deleteById.mockResolvedValue(true);

      await expect(service.revokeCredential('user-1', 'cred-1')).resolves.toBeUndefined();
      expect(mockRepo.deleteById).toHaveBeenCalledWith('user-1', 'cred-1');
    });
  });
});
