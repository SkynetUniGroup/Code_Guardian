export interface EncryptedCredential {
  ciphertext: Buffer;
  iv: Buffer;
  salt: Buffer;
  authTag: Buffer;
}
