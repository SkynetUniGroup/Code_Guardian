import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ServiceCredential,
  ServiceCredentialDocument,
} from './schemas/service-credential.schema';
import { CredentialCipherService } from './credential-cipher.service';
import { GithubClientService } from '../github/github-client.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { ServiceCredentialDto } from './dto/service-credential.dto';
import { AppException } from '../common/exceptions/app.exception';

const REQUIRED_GITHUB_SCOPE = 'repo';

@Injectable()
export class CredentialsService {
  constructor(
    @InjectModel(ServiceCredential.name)
    private readonly credentialModel: Model<ServiceCredentialDocument>,
    private readonly cipher: CredentialCipherService,
    private readonly github: GithubClientService,
  ) {}

  // Nothing is persisted unless the live GitHub check passes (§4.2,
  // RF.13–RF.14). The upsert on (userId, provider) means reconnecting an
  // already-configured provider replaces it instead of creating a second row
  // — the unique index on the schema would reject a plain insert here, and
  // that's the point: this is the one path allowed to satisfy it.
  async create(
    userId: string,
    dto: CreateCredentialDto,
  ): Promise<ServiceCredentialDto> {
    await this.verifyGithubToken(dto.token);

    const encrypted = this.cipher.encrypt(dto.token);
    const connectedAt = new Date();

    const credential = await this.credentialModel.findOneAndUpdate(
      { userId, provider: dto.provider },
      { ...encrypted, connectedAt },
      { upsert: true, new: true },
    );

    return this.toDto(credential);
  }

  async list(userId: string): Promise<ServiceCredentialDto[]> {
    const credentials = await this.credentialModel.find({ userId });
    return credentials.map((credential) => this.toDto(credential));
  }

  // Local revocation only: this removes the ciphertext from our database but
  // does not revoke the token on GitHub's side — that stays the user's own
  // action (§4.1). Scoped to (id, userId) so one user can never delete
  // another's credential by guessing an id.
  async remove(userId: string, id: string): Promise<void> {
    const result = await this.credentialModel.findOneAndDelete({
      _id: id,
      userId,
    });
    if (!result) {
      throw new NotFoundException('Credential not found');
    }
  }

  // Re-checks a credential that's already saved (the "Verifica di nuovo"
  // button, §4.2) — distinct from `create`'s pre-save check. On failure the
  // stored ciphertext is left exactly as it was: a token that stopped
  // working is still evidence the user may want to see or fix, not a reason
  // to silently delete their configuration.
  async revalidate(userId: string, id: string): Promise<ServiceCredentialDto> {
    const credential = await this.credentialModel.findOne({
      _id: id,
      userId,
    });
    if (!credential) {
      throw new NotFoundException('Credential not found');
    }

    const token = this.cipher.decrypt(credential);
    await this.verifyGithubToken(token);

    credential.connectedAt = new Date();
    await credential.save();

    return this.toDto(credential);
  }

  // Not one of the four endpoints this issue lists, but every later feature
  // that calls GitHub on a user's behalf (repository browsing, context
  // creation, PR opening) needs a way to get that user's live token — and
  // this is the only service that ever touches the cipher, so it's the one
  // place this can live.
  async getDecryptedToken(userId: string, provider: string): Promise<string> {
    const credential = await this.credentialModel.findOne({
      userId,
      provider,
    });
    if (!credential) {
      throw new NotFoundException(
        `No ${provider} credential configured for this user`,
      );
    }
    return this.cipher.decrypt(credential);
  }

  // A 401 means GitHub itself rejected the token — bad or revoked. Missing
  // the required scope is treated the same way: either case means this
  // credential can't do what Code Guardian needs it for, and the frontend's
  // secondary action is the same for both ("Rimanda a /credentials").
  // Anything else — network failure, GitHub 5xx, a rate-limit 403 — is
  // deliberately NOT caught here: it propagates to the global exception
  // filter and falls back to UPSTREAM. A dropped connection must never look
  // like a bad credential (§4.2, RS.4).
  private async verifyGithubToken(token: string): Promise<void> {
    let scopes: string[];
    try {
      ({ scopes } = await this.github.verifyToken(token));
    } catch (error) {
      if (this.isUnauthorized(error)) {
        throw new AppException(
          'CREDENTIAL_INVALID',
          'GitHub rejected this token.',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }

    // Fine-grained PATs (`github_pat_...`) don't use GitHub's OAuth scope
    // model at all — they grant per-repository, per-resource permissions
    // instead, and GitHub never populates X-OAuth-Scopes for them (it comes
    // back empty, not missing "repo"). There's no endpoint to introspect a
    // fine-grained token's grants without already knowing a repository, so
    // the only thing checked here for one is that GitHub accepted it at
    // all — its actual repository access gets verified for real, for every
    // token type, once a repository is selected (§ Raggiungibilità e
    // accesso, POST /contexts). Rejecting a fine-grained token here based on
    // an empty scope list would be a false negative, not a safety net.
    if (this.isFineGrainedToken(token)) {
      return;
    }

    if (!scopes.includes(REQUIRED_GITHUB_SCOPE)) {
      throw new AppException(
        'CREDENTIAL_INVALID',
        `This token is missing the required "${REQUIRED_GITHUB_SCOPE}" scope.`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private isFineGrainedToken(token: string): boolean {
    return token.startsWith('github_pat_');
  }

  private isUnauthorized(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 401
    );
  }

  private toDto(credential: ServiceCredentialDocument): ServiceCredentialDto {
    return {
      id: credential._id.toString(),
      provider: credential.provider,
      connectedAt: credential.connectedAt.toISOString(),
    };
  }
}
