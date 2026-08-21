/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { CredentialsController } from './credentials.controller.js';
import { CredentialVaultService } from '../internal/credential-vault.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

describe('CredentialsController', () => {
  let controller: CredentialsController;
  let mockVaultService: {
    saveToken: jest.Mock;
    listCredentials: jest.Mock;
    validateToken: jest.Mock;
    revokeCredential: jest.Mock;
  };

  beforeEach(async () => {
    mockVaultService = {
      saveToken: jest.fn().mockResolvedValue(undefined),
      listCredentials: jest.fn(),
      validateToken: jest.fn(),
      revokeCredential: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CredentialsController],
      providers: [{ provide: CredentialVaultService, useValue: mockVaultService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CredentialsController>(CredentialsController);
  });

  describe('saveCredential', () => {
    it('dovrebbe usare GITHUB come provider di default quando non specificato', async () => {
      const result = await controller.saveCredential('user-1', { provider: undefined as any, token: 'ghp_x' });

      expect(mockVaultService.saveToken).toHaveBeenCalledWith('user-1', 'GITHUB', 'ghp_x');
      expect(result).toEqual({ message: 'Credenziale salvata con successo' });
    });

    it('dovrebbe rispettare il provider esplicitamente indicato', async () => {
      await controller.saveCredential('user-1', { provider: 'CUSTOM', token: 'tok' });

      expect(mockVaultService.saveToken).toHaveBeenCalledWith('user-1', 'CUSTOM', 'tok');
    });
  });

  it('getCredentials dovrebbe delegare al vault service', async () => {
    mockVaultService.listCredentials.mockResolvedValue([{ id: 'c1', provider: 'GITHUB', configured: true }]);

    const result = await controller.getCredentials('user-1');

    expect(mockVaultService.listCredentials).toHaveBeenCalledWith('user-1');
    expect(result).toEqual([{ id: 'c1', provider: 'GITHUB', configured: true }]);
  });

  it('validateCredential dovrebbe delegare al vault service con id e userId', async () => {
    mockVaultService.validateToken.mockResolvedValue({ valid: true, scopes: ['repo'] });

    const result = await controller.validateCredential('c1', 'user-1');

    expect(mockVaultService.validateToken).toHaveBeenCalledWith('user-1', 'c1');
    expect(result).toEqual({ valid: true, scopes: ['repo'] });
  });

  it('revokeCredential dovrebbe delegare al vault service e non restituire alcun contenuto (204)', async () => {
    const result = await controller.revokeCredential('c1', 'user-1');

    expect(mockVaultService.revokeCredential).toHaveBeenCalledWith('user-1', 'c1');
    expect(result).toBeUndefined();
  });
});
