import { Injectable, NotFoundException } from '@nestjs/common';
import { GithubClientService } from '../github/github-client.service';
import { parseGithubUrl } from './github-url';

export interface ResolvedRepo {
  owner: string;
  repo: string;
  isPrivate: boolean;
}

// Steps 1-3 of the context validation sequence (mvp_backend_design.tex,
// "Sequenza di validazione"): URL syntax is enforced upstream by each
// caller's own DTO (@Matches on GITHUB_REPO_URL_REGEX), not repeated here;
// this covers owner/repo extraction and the reachability check. Shared by
// GET /repositories/refs, GET /repositories/tree, and POST /contexts (BE-11)
// — each calls this independently, none reuses another's result, per the
// same section.
@Injectable()
export class RepoResolverService {
  constructor(private readonly githubClient: GithubClientService) {}

  async resolve(token: string, repoUrl: string): Promise<ResolvedRepo> {
    const { owner, repo } = parseGithubUrl(repoUrl);

    try {
      const summary = await this.githubClient.getRepository(token, owner, repo);
      return { owner, repo, isPrivate: summary.isPrivate };
    } catch (error) {
      if (this.isNotFound(error)) {
        // Deliberately one combined error for "doesn't exist" and "exists
        // but this token can't see it": GitHub returns the same 404 for a
        // private repo the token can't see, so the two cases are
        // indistinguishable from the API itself.
        throw new NotFoundException(
          `Repository ${owner}/${repo} not found or not accessible with the configured credential.`,
        );
      }
      throw error;
    }
  }

  private isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 404
    );
  }
}
