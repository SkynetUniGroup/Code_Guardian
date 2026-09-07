import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// OWASP-minimum parameters for the MVP. Unlike BE-5's AES-GCM cipher, the
// salt lives inside the encoded hash string argon2 produces — nothing
// separate to store or manage ourselves.
const HASH_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB, in KiB
  timeCost: 3,
  parallelism: 4,
};

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, HASH_OPTIONS);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }
}
