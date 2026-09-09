import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { Model } from "mongoose";
import { AppException } from "../common/exceptions/app.exception";
import { GithubClientService } from "../github/github-client.service";
import {
  SonarqubeClientService,
  type SonarqubeProjectRef,
} from "../sonarqube/sonarqube-client.service";
import { CredentialCipherService } from "./credential-cipher.service";
import type { CreateCredentialDto } from "./dto/create-credential.dto";
import type { ServiceCredentialDto } from "./dto/service-credential.dto";
import {
  ServiceCredential,
  type ServiceCredentialDocument,
} from "./schemas/service-credential.schema";
import { SONARQUBE_PROVIDER } from "./supported-providers";

const REQUIRED_GITHUB_SCOPE = "repo";

// What a SONARQUBE credential decrypts back to. Stored as one JSON blob
// through the same single-string cipher GitHub uses (only `token` is
// secret, but encrypting the whole bundle keeps one code path and one
// record shape). This is exactly the object the Python agents expect under
// `sonarqube_credentials` in the agent payload — see
// agents/src/sonarqube_service.py SonarQubeCredentials.from_dict.
export interface SonarqubeCredentialPayload {
  instanceUrl: string;
  projectKey: string;
  token: string;
  organizationKey?: string;
}

@Injectable()
export class CredentialsService {
  constructor(
    @InjectModel(ServiceCredential.name)
    private readonly credentialModel: Model<ServiceCredentialDocument>,
    private readonly cipher: CredentialCipherService,
    private readonly github: GithubClientService,
    private readonly sonarqube: SonarqubeClientService,
  ) {}

  // Nothing is persisted unless the live provider check passes (§4.2,
  // RF.13–RF.14). The upsert on (userId, provider) means reconnecting an
  // already-configured provider replaces it instead of creating a second row
  // — the unique index on the schema would reject a plain insert here, and
  // that's the point: this is the one path allowed to satisfy it.
  async create(userId: string, dto: CreateCredentialDto): Promise<ServiceCredentialDto> {
    await this.verifyCredential(dto);

    const encrypted = this.cipher.encrypt(this.serializeSecret(dto));
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

  // Existence-only, deliberately not getDecryptedToken(): BE-13's
  // pre-accept check on POST /tasks only needs to know a credential is
  // configured, not decrypt it. The scope/reachability check already ran
  // once at save time (RS.4); repeating a decrypt on every task start would
  // be pure waste for a question this cheap to answer.
  async hasCredential(userId: string, provider: string): Promise<boolean> {
    const match = await this.credentialModel.exists({ userId, provider });
    return match !== null;
  }

  // Local revocation only: this removes the ciphertext from our database but
  // does not revoke the token on the provider's side — that stays the user's
  // own action (§4.1). Scoped to (id, userId) so one user can never delete
  // another's credential by guessing an id.
  async remove(userId: string, id: string): Promise<void> {
    const result = await this.credentialModel.findOneAndDelete({
      _id: id,
      userId,
    });
    if (!result) {
      throw new NotFoundException("Credential not found");
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
      throw new NotFoundException("Credential not found");
    }

    const secret = this.cipher.decrypt(credential);
    await this.verifyStoredSecret(credential.provider, secret);

    credential.connectedAt = new Date();
    await credential.save();

    return this.toDto(credential);
  }

  // Not one of the four endpoints this issue lists, but every later feature
  // that calls GitHub on a user's behalf (repository browsing, context
  // creation, PR opening) needs a way to get that user's live token — and
  // this is the only service that ever touches the cipher, so it's the one
  // place this can live. GITHUB only: a SONARQUBE record decrypts to a JSON
  // bundle, not a bare token — use getDecryptedSonarqubeCredential for that.
  async getDecryptedToken(userId: string, provider: string): Promise<string> {
    const credential = await this.credentialModel.findOne({
      userId,
      provider,
    });
    if (!credential) {
      throw new NotFoundException(`No ${provider} credential configured for this user`);
    }
    return this.cipher.decrypt(credential);
  }

  // The SONARQUBE counterpart of getDecryptedToken: returns the full bundle
  // the agents need, or null when the user simply has no SonarQube
  // credential — SonarQube is optional (it enriches DOCS prompts, it does
  // not gate anything), so "not configured" is a normal state the caller
  // handles by omitting the metrics, not an error.
  async getDecryptedSonarqubeCredential(
    userId: string,
  ): Promise<SonarqubeCredentialPayload | null> {
    const credential = await this.credentialModel.findOne({
      userId,
      provider: SONARQUBE_PROVIDER,
    });
    if (!credential) {
      return null;
    }
    return JSON.parse(this.cipher.decrypt(credential)) as SonarqubeCredentialPayload;
  }

  // ─────────────────────────── per-provider ───────────────────────────

  private serializeSecret(dto: CreateCredentialDto): string {
    if (dto.provider === SONARQUBE_PROVIDER) {
      const payload: SonarqubeCredentialPayload = {
        instanceUrl: dto.instanceUrl as string,
        projectKey: dto.projectKey as string,
        token: dto.token,
        ...(dto.organizationKey ? { organizationKey: dto.organizationKey } : {}),
      };
      return JSON.stringify(payload);
    }
    return dto.token;
  }

  private async verifyCredential(dto: CreateCredentialDto): Promise<void> {
    if (dto.provider === SONARQUBE_PROVIDER) {
      await this.sonarqube.verifyProjectAccess(this.sonarRefFromDto(dto));
      return;
    }
    await this.verifyGithubToken(dto.token);
  }

  private async verifyStoredSecret(provider: string, secret: string): Promise<void> {
    if (provider === SONARQUBE_PROVIDER) {
      const payload = JSON.parse(secret) as SonarqubeCredentialPayload;
      await this.sonarqube.verifyProjectAccess(payload);
      return;
    }
    await this.verifyGithubToken(secret);
  }

  private sonarRefFromDto(dto: CreateCredentialDto): SonarqubeProjectRef {
    return {
      instanceUrl: dto.instanceUrl as string,
      projectKey: dto.projectKey as string,
      token: dto.token,
      organizationKey: dto.organizationKey,
    };
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
          "CREDENTIAL_INVALID",
          "GitHub rejected this token.",
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
        "CREDENTIAL_INVALID",
        `This token is missing the required "${REQUIRED_GITHUB_SCOPE}" scope.`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private isFineGrainedToken(token: string): boolean {
    return token.startsWith("github_pat_");
  }

  private isUnauthorized(error: unknown): boolean {
    return typeof error === "object" && error !== null && "status" in error && error.status === 401;
  }

  private toDto(credential: ServiceCredentialDocument): ServiceCredentialDto {
    return {
      id: credential._id.toString(),
      provider: credential.provider,
      connectedAt: credential.connectedAt.toISOString(),
    };
  }
}
