/// <reference types="jest" />
import { HmacGuard } from './hmac.guard.js';
import { ExecutionContext, UnauthorizedException, RequestTimeoutException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

describe('HmacGuard', () => {
  let guard: HmacGuard;
  let mockConfigService: Partial<ConfigService>;
  const secret = 'super-secret-key-for-test';

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockReturnValue(secret),
    };
    guard = new HmacGuard(mockConfigService as ConfigService);
  });

  const createMockContext = (headers: any, body: any): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        body,
        rawBody: Buffer.from(JSON.stringify(body)),
      }),
    }),
  } as unknown as ExecutionContext);

  it('dovrebbe rifiutare (401) se mancano gli header HMAC o il timestamp (Appendice C)', () => {
    const context = createMockContext({}, { data: 'test' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('dovrebbe rifiutare (408) se il timestamp è più vecchio di 60 secondi (Appendice C)', () => {
    const expiredTimestamp = Date.now() - 65000; // 65 secondi fa
    const context = createMockContext({
      'x-signature': 'fake-signature',
      'x-timestamp': expiredTimestamp.toString(),
    }, { data: 'test' });

    expect(() => guard.canActivate(context)).toThrow(RequestTimeoutException);
  });

  it('dovrebbe rifiutare (401) se la firma HMAC non è valida (Appendice C)', () => {
    const context = createMockContext({
      'x-signature': 'invalid-signature-12345',
      'x-timestamp': Date.now().toString(),
    }, { data: 'test' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('dovrebbe consentire l\'accesso se la firma HMAC è valida e non scaduta', () => {
    const timestamp = Date.now().toString();
    const body = { data: 'test' };
    const rawBody = JSON.stringify(body);
    
    // Genera una firma valida come farebbe il client Python
    const payload = `${timestamp}.${rawBody}`;
    const validSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const context = createMockContext({
      'x-signature': validSignature,
      'x-timestamp': timestamp,
    }, body);

    expect(guard.canActivate(context)).toBe(true);
  });
});