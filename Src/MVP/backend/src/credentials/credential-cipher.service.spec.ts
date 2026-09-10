import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CredentialCipherService } from './credential-cipher.service';

describe('CredentialCipherService', () => {
  let service: CredentialCipherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialCipherService,
        {
          provide: ConfigService,
          useValue: {
            get: () => 'test-only-master-key-never-use-in-real-env',
          },
        },
      ],
    }).compile();

    service = module.get(CredentialCipherService);
  });

  it('round-trips: decrypting an encrypted value returns the original plaintext', () => {
    const plaintext = 'ghp_someGitHubPersonalAccessToken';
    const record = service.encrypt(plaintext);
    expect(service.decrypt(record)).toBe(plaintext);
  });

  it('encrypts the same plaintext differently each time', () => {
    const plaintext = 'ghp_someGitHubPersonalAccessToken';
    const a = service.encrypt(plaintext);
    const b = service.encrypt(plaintext);

    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.salt.equals(b.salt)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
  });

  it('refuses to decrypt if the ciphertext was tampered with', () => {
    const record = service.encrypt('ghp_someGitHubPersonalAccessToken');
    record.ciphertext[0] ^= 0xff;

    expect(() => service.decrypt(record)).toThrow();
  });

  it('refuses to decrypt if the auth tag was tampered with', () => {
    const record = service.encrypt('ghp_someGitHubPersonalAccessToken');
    record.authTag[0] ^= 0xff;

    expect(() => service.decrypt(record)).toThrow();
  });
});
