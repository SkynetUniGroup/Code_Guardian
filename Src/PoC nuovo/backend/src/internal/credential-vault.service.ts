import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Octokit } from 'octokit';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { CREDENTIAL_REPOSITORY } from '../domain/repositories/repository.interfaces.js';
import type { IServiceCredentialRepository } from '../domain/repositories/repository.interfaces.js';

@Injectable()
export class CredentialVaultService {
  private readonly algorithm = 'aes-256-gcm';

  constructor(
    @Inject(CREDENTIAL_REPOSITORY) private credentialRepo: IServiceCredentialRepository,
    private configService: ConfigService,
  ) {}

  private getMasterKey(): string {
    const key = this.configService.get<string>('CREDENTIAL_MASTER_KEY');
    if (!key) throw new Error("CREDENTIAL_MASTER_KEY non configurata");
    return key;
  }

  async saveToken(userId: string, provider: string, token: string): Promise<void> {
    const masterKey = this.getMasterKey();
    
    // Generiamo un salt e un IV casuali per ogni salvataggio
    const salt = crypto.randomBytes(16).toString('hex');
    const iv = crypto.randomBytes(12);
    
    // Derivazione chiave sicura
    const key = crypto.scryptSync(masterKey, salt, 32);

    const cipher = crypto.createCipheriv(this.algorithm, key, iv);
    let ciphertext = cipher.update(token, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');

    // Deleghiamo al DB il salvataggio o l'aggiornamento
    await this.credentialRepo.upsertCredential(userId, provider, {
      ciphertext,
      iv: iv.toString('hex'),
      authTag,
      salt,
    });
  }

  private decrypt(credential: any): string {
  const masterKey = this.getMasterKey();
  const key = crypto.scryptSync(masterKey, credential.salt, 32);

  const decipher = crypto.createDecipheriv(
    this.algorithm,
    key,
    Buffer.from(credential.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(credential.authTag, 'hex'));

  let decrypted = decipher.update(credential.ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

  async getDecryptedToken(userId: string, provider: string = 'GITHUB'): Promise<string> {
  const credential = await this.credentialRepo.findByUserIdAndProvider(userId, provider);
  if (!credential) {
    throw new NotFoundException(`Nessuna credenziale ${provider} configurata per l'utente ${userId}`);
  }
  return this.decrypt(credential);
}
async listCredentials(userId: string) {
  const credentials = await this.credentialRepo.findAllByUserId(userId);
  return credentials.map((c) => ({
    id: c._id.toString(),
    provider: c.provider,
    configured: true,
    createdAt: (c as any).createdAt,
  }));
}

async validateToken(userId: string, id: string): Promise<{ valid: boolean; scopes: string[] }> {
  const credential = await this.credentialRepo.findById(userId, id);
  if (!credential) {
    throw new NotFoundException(`Credenziale ${id} non trovata`);
  }
  const token = this.decrypt(credential);
  const octokit = new Octokit({ auth: token });
  try {
    const response = await octokit.request('GET /user');
    const scopesHeader = (response.headers['x-oauth-scopes'] as string) || '';
    const scopes = scopesHeader.split(',').map((s) => s.trim()).filter(Boolean);
    return { valid: true, scopes };
  } catch {
    return { valid: false, scopes: [] };
  }
}

async revokeCredential(userId: string, id: string): Promise<void> {
  const deleted = await this.credentialRepo.deleteById(userId, id);
  if (!deleted) {
    throw new NotFoundException(`Credenziale ${id} non trovata`);
  }
}
}