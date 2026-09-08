import { Injectable } from '@nestjs/common';
import { CredentialsService } from '../credentials/credentials.service';
import { GithubClientService } from '../github/github-client.service';
import { detectLanguage } from '../github/language-detection';
import { RefSummary, RepositorySummary } from '../github/github-client.types';
import { RepoResolverService } from './repo-resolver.service';
import { RepositoryTreeDto } from './dto/repository-tree.dto';

const GITHUB_PROVIDER = 'GITHUB';

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly githubClient: GithubClientService,
    private readonly repoResolver: RepoResolverService,
  ) {}

  async list(userId: string): Promise<RepositorySummary[]> {
    const token = await this.credentials.getDecryptedToken(
      userId,
      GITHUB_PROVIDER,
    );
    return this.githubClient.listRepositories(token);
  }

  async refs(userId: string, repoUrl: string): Promise<RefSummary> {
    const token = await this.credentials.getDecryptedToken(
      userId,
      GITHUB_PROVIDER,
    );
    const { owner, repo } = await this.repoResolver.resolve(token, repoUrl);
    return this.githubClient.listRefs(token, owner, repo);
  }

  async tree(
    userId: string,
    repoUrl: string,
    branch: string,
    commitSha?: string,
  ): Promise<RepositoryTreeDto> {
    const token = await this.credentials.getDecryptedToken(
      userId,
      GITHUB_PROVIDER,
    );
    const { owner, repo } = await this.repoResolver.resolve(token, repoUrl);
    const sha =
      commitSha ??
      (await this.githubClient.resolveRefToSha(token, owner, repo, branch));
    const entries = await this.githubClient.getTree(token, owner, repo, sha);

    // Unfiltered on purpose: this is every language found, not just the
    // supported ones. Filtering to the supported set (RV.7) happens at
    // context construction (POST /contexts, BE-11), not here — this
    // endpoint is a non-blocking, purely informational read for the
    // frontend's file picker (§ Linguaggi supportati). "unknown" is dropped
    // because it isn't a language, just files the heuristic doesn't
    // recognize.
    const detectedLanguages = [
      ...new Set(
        entries
          .filter((entry) => entry.type === 'file')
          .map((entry) => detectLanguage(entry.path))
          .filter((language) => language !== 'unknown'),
      ),
    ];

    return { entries, detectedLanguages };
  }
}
