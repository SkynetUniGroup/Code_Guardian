/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { RequestTimeoutException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AgentGatewayService } from './agent-gateway.service.js';
import type { AgentDescriptor } from './agent.registry.js';

/**
 * Questi test coprono il requisito centrale dell'Orchestratore: catturare le
 * eccezioni del componente esterno (l'agente Python / il provider LLM che
 * esso interpella) e convertirle in esiti controllati e codificati, invece
 * di lasciarle risalire come errori Axios grezzi.
 */
describe('AgentGatewayService', () => {
  let service: AgentGatewayService;
  let mockHttpService: { post: jest.Mock };
  let mockConfigService: { get: jest.Mock };

  const descriptor: AgentDescriptor = {
    agentId: 'security',
    operation: 'SECURITY_OWASP',
    destinationUrl: '/agents/security/run',
  };

  beforeEach(async () => {
    mockHttpService = { post: jest.fn() };
    mockConfigService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentGatewayService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AgentGatewayService>(AgentGatewayService);
  });

  it('dovrebbe essere definito', () => {
    expect(service).toBeDefined();
  });

  it('dovrebbe restituire i dati della risposta in caso di successo, componendo correttamente l\'URL configurato', async () => {
    mockConfigService.get.mockReturnValue('http://agents-custom:9000');
    const responseBody = { status: 'COMPLETED', summary: 'ok' };
    mockHttpService.post.mockReturnValue(of({ data: responseBody }));

    const result = await service.invokeAgent(descriptor, { taskId: 't1' });

    expect(result).toEqual(responseBody);
    expect(mockHttpService.post).toHaveBeenCalledWith(
      'http://agents-custom:9000/agents/security/run',
      { taskId: 't1' },
      expect.objectContaining({ timeout: 100000 }),
    );
  });

  it('dovrebbe usare l\'URL di default http://agents:8000 se AGENTS_BASE_URL non e\' configurato', async () => {
    mockConfigService.get.mockReturnValue(undefined);
    mockHttpService.post.mockReturnValue(of({ data: {} }));

    await service.invokeAgent(descriptor, {});

    expect(mockHttpService.post).toHaveBeenCalledWith(
      'http://agents:8000/agents/security/run',
      {},
      expect.any(Object),
    );
  });

  it('dovrebbe convertire un errore per timeout (ECONNABORTED) in RequestTimeoutException (esito codificato)', async () => {
    mockConfigService.get.mockReturnValue('http://agents:8000');
    const axiosTimeoutError: any = new Error('timeout of 100000ms exceeded');
    axiosTimeoutError.code = 'ECONNABORTED';
    mockHttpService.post.mockReturnValue(throwError(() => axiosTimeoutError));

    await expect(service.invokeAgent(descriptor, {})).rejects.toThrow(RequestTimeoutException);
  });

  it('dovrebbe convertire un errore il cui messaggio contiene "timeout" in RequestTimeoutException anche senza codice ECONNABORTED', async () => {
    mockConfigService.get.mockReturnValue('http://agents:8000');
    const genericTimeoutError = new Error('socket hang up: timeout while waiting for response');
    mockHttpService.post.mockReturnValue(throwError(() => genericTimeoutError));

    await expect(service.invokeAgent(descriptor, {})).rejects.toThrow(RequestTimeoutException);
  });

  it('dovrebbe propagare inalterato un errore che non e\' un timeout (es. 500 dall\'agente)', async () => {
    mockConfigService.get.mockReturnValue('http://agents:8000');
    const upstreamError: any = new Error('Request failed with status code 500');
    upstreamError.code = 'ERR_BAD_RESPONSE';
    mockHttpService.post.mockReturnValue(throwError(() => upstreamError));

    await expect(service.invokeAgent(descriptor, {})).rejects.toThrow('Request failed with status code 500');
    await expect(service.invokeAgent(descriptor, {})).rejects.not.toThrow(RequestTimeoutException);
  });
});
