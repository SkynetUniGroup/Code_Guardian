/// <reference types="jest" />
import { HmacGuard } from './hmac.guard.js';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Completa hmac.guard.spec.ts con il ramo di configurazione mancante:
 * INTERNAL_SHARED_SECRET non impostato lato backend (errore di deploy, non
 * di richiesta) deve fallire in modo esplicito invece di lasciar passare
 * richieste non firmabili.
 */
describe('HmacGuard - configurazione mancante', () => {
  const createMockContext = (headers: any, body: any): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({ headers, body, rawBody: Buffer.from(JSON.stringify(body)) }),
    }),
  } as unknown as ExecutionContext);

  it('dovrebbe lanciare un errore esplicito se INTERNAL_SHARED_SECRET non e\' configurato sul backend', () => {
    const mockConfigService: Partial<ConfigService> = { get: jest.fn().mockReturnValue(undefined) };
    const guard = new HmacGuard(mockConfigService as ConfigService);

    const context = createMockContext(
      { 'x-signature': 'qualunque', 'x-timestamp': Date.now().toString() },
      { data: 'test' },
    );

    expect(() => guard.canActivate(context)).toThrow('INTERNAL_SHARED_SECRET non configurato');
  });
});
