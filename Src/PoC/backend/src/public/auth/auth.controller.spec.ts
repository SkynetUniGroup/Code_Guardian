/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';

describe('AuthController', () => {
  let controller: AuthController;
  let mockJwtService: { sign: jest.Mock };

  beforeEach(async () => {
    mockJwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: JwtService, useValue: mockJwtService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('register dovrebbe restituire il messaggio di stub, senza persistere nulla (funzionalita\' rimandata)', () => {
    const result = controller.register({ email: 'x@y.com', password: 'pw' });

    expect(result).toEqual({ message: 'Registrazione disabilitata in questo PoC (stub)' });
  });

  it('login dovrebbe firmare e restituire un accessToken per l\'utente mock del PoC', () => {
    const result = controller.login();

    expect(mockJwtService.sign).toHaveBeenCalledWith({ sub: 'user-123', email: 'test@skynet.com' });
    expect(result).toEqual({ accessToken: 'signed.jwt.token' });
  });

  it('healthCheck dovrebbe segnalare lo stato ok del servizio backend', () => {
    expect(controller.healthCheck()).toEqual({ status: 'ok', service: 'backend' });
  });

  it('getProfile dovrebbe restituire lo userId iniettato dal guard JWT', () => {
    const result = controller.getProfile('user-42');

    expect(result).toEqual({ userId: 'user-42', email: 'test@skynet.com', role: 'DEVELOPER' });
  });
});
