import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('round-trips: verifying a hash against its original plaintext succeeds', async () => {
    const hash = await service.hash('Sup3rSecret');
    await expect(service.verify(hash, 'Sup3rSecret')).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await service.hash('Sup3rSecret');
    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('hashes the same password differently each time', async () => {
    const a = await service.hash('Sup3rSecret');
    const b = await service.hash('Sup3rSecret');
    expect(a).not.toBe(b);
  });
});
