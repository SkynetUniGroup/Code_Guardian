import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'crypto';
import { EncryptedCredential } from './encrypted-credential';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32; // AES-256
const IV_LENGTH_BYTES = 12; // recommended IV length for GCM
const SALT_LENGTH_BYTES = 32;
const HKDF_INFO = 'credential-enc';

@Injectable()
export class CredentialCipherService {
  constructor(private readonly config: ConfigService) {}

  encrypt(plaintext: string): EncryptedCredential {
    const salt = randomBytes(SALT_LENGTH_BYTES);
    const iv = randomBytes(IV_LENGTH_BYTES);
    const key = this.deriveKey(salt);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return { ciphertext, iv, salt, authTag };
  }

  decrypt(record: EncryptedCredential): string {
    const key = this.deriveKey(record.salt);

    const decipher = createDecipheriv(ALGORITHM, key, record.iv);
    decipher.setAuthTag(record.authTag);

    const plaintext = Buffer.concat([
      decipher.update(record.ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  // Same master key, different salt per record: a compromised derived key
  // only exposes the one credential it belongs to, never the master key or
  // any other record (BE-ADR-7).
  private deriveKey(salt: Buffer): Buffer {
    const masterKey = this.config.get<string>('CREDENTIAL_MASTER_KEY');
    if (!masterKey) {
      throw new Error('CREDENTIAL_MASTER_KEY is not configured');
    }
    const derived = hkdfSync(
      'sha256',
      Buffer.from(masterKey, 'utf8'),
      salt,
      HKDF_INFO,
      KEY_LENGTH_BYTES,
    );
    return Buffer.from(derived);
  }
}
