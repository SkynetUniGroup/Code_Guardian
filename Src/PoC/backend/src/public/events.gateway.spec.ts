/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway.js';

describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let mockJwtService: { verify: jest.Mock };
  let mockServer: { to: jest.Mock };
  let mockEmit: jest.Mock;

  function makeClient(overrides: Partial<any> = {}) {
    return {
      id: 'socket-1',
      handshake: { auth: {}, headers: {} },
      data: {},
      join: jest.fn(),
      disconnect: jest.fn(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockJwtService = { verify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);

    mockEmit = jest.fn();
    mockServer = { to: jest.fn().mockReturnValue({ emit: mockEmit }) };
    gateway.server = mockServer as any;
  });

  describe('handleConnection - autenticazione via WebSocket', () => {
    it('dovrebbe disconnettere il client se manca sia il token in auth sia l\'header Authorization', () => {
      const client = makeClient();

      gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('dovrebbe autenticare ed unire alla stanza "user:<id>" un client con token valido in handshake.auth.token', () => {
      mockJwtService.verify.mockReturnValue({ sub: 'user-42' });
      const client = makeClient({ handshake: { auth: { token: 'valid-jwt' }, headers: {} } });

      gateway.handleConnection(client as any);

      expect(client.data.userId).toBe('user-42');
      expect(client.join).toHaveBeenCalledWith('user:user-42');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('dovrebbe estrarre il token anche dall\'header Authorization: Bearer <token>', () => {
      mockJwtService.verify.mockReturnValue({ sub: 'user-7' });
      const client = makeClient({ handshake: { auth: {}, headers: { authorization: 'Bearer header-token' } } });

      gateway.handleConnection(client as any);

      expect(mockJwtService.verify).toHaveBeenCalledWith('header-token');
      expect(client.join).toHaveBeenCalledWith('user:user-7');
    });

    it('dovrebbe disconnettere il client se il token e\' presente ma non valido', () => {
      mockJwtService.verify.mockImplementation(() => { throw new Error('invalid signature'); });
      const client = makeClient({ handshake: { auth: { token: 'bad-token' }, headers: {} } });

      gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('non dovrebbe lanciare eccezioni alla disconnessione', () => {
      expect(() => gateway.handleDisconnect(makeClient() as any)).not.toThrow();
    });
  });

  describe('emissione degli eventi scoped per utente', () => {
    it('emitTaskProgress dovrebbe emettere sulla stanza dell\'utente destinatario', () => {
      gateway.emitTaskProgress('task-1', 'invoca_llm', 40, 'user-1');

      expect(mockServer.to).toHaveBeenCalledWith('user:user-1');
      expect(mockEmit).toHaveBeenCalledWith('task.progress', { taskId: 'task-1', stage: 'invoca_llm', percent: 40 });
    });

    it('emitTaskUpdated dovrebbe includere lo status e il reportId opzionale', () => {
      gateway.emitTaskUpdated('task-1', 'COMPLETED', 'report-1', 'user-1');

      expect(mockEmit).toHaveBeenCalledWith('task.updated', { taskId: 'task-1', status: 'COMPLETED', reportId: 'report-1' });
    });

    it('emitTaskFailed dovrebbe includere l\'oggetto errore', () => {
      const error = { kind: 'UPSTREAM', message: 'x', stage: 'agent_invocation' };
      gateway.emitTaskFailed('task-1', error, 'user-1');

      expect(mockEmit).toHaveBeenCalledWith('task.failed', { taskId: 'task-1', error });
    });

    it('emitBatchCompleted dovrebbe includere i conteggi di successi e fallimenti', () => {
      gateway.emitBatchCompleted('batch-1', 3, 1, 'user-1');

      expect(mockEmit).toHaveBeenCalledWith('batch.completed', { batchId: 'batch-1', completed: 3, failed: 1 });
    });

    it('non dovrebbe emettere alcun evento (data leak prevention) se lo userId e\' assente', () => {
      gateway.emitTaskUpdated('task-1', 'COMPLETED', 'report-1', undefined);

      expect(mockServer.to).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
