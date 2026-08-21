/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let mockConfigService: Partial<ConfigService>;

  beforeEach(() => {
    mockConfigService = { get: jest.fn().mockReturnValue('test-jwt-secret') };
    strategy = new JwtStrategy(mockConfigService as ConfigService);
  });

  it('dovrebbe essere definita', () => {
    expect(strategy).toBeDefined();
  });

  it('validate() dovrebbe proiettare il payload del token nell\'oggetto utente iniettato in Request', async () => {
    const payload = { sub: 'user-42', email: 'dev@skynet.com', iat: 1700000000, exp: 1700003600 };

    const result = await strategy.validate(payload);

    expect(result).toEqual({ userId: 'user-42', email: 'dev@skynet.com' });
  });
});
