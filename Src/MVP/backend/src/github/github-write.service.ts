import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { applyPatch } from 'diff';
import { GithubClientService } from './github-client.service';
import { AppException } from '../common/exceptions/app.exception';

export interface ProposalChange {
  operationCode: string;
  targetPath: string;
  diffUnified: string;
  title: string;
}

// The write counterpart to GithubClientService's read-only facade
// (mvp_backend_design.tex, "Ciò che resta fuori dalla facade" / ADR-4).
// Deliberately its own client, never bolted onto GithubClientService: that
// class enforces read-only by throwing on any non-GET request, and that
// guard is meant to stay true by construction. Read calls this service needs
// (resolving a branch's HEAD, fetching a file's current content) go through
// GithubClientService anyway, so the read-only guarantee — and the Redis
// cache behind it — still applies to every read this service performs.
@Injectable()
export class GithubWriteService {
  constructor(private readonly githubClient: GithubClientService) {}

  private writeClient(token: string): Octokit {
    return new Octokit({ auth: token });
  }

  // "<namespace>/<scope>/<id>" is the same shape Dependabot and Renovate use
  // for bot-generated branches: namespaced so it can never collide with a
  // human's branch, and suffixed with a short random id (not the report id —
  // this service doesn't know about Report/Task at all) so re-running the
  // same operation twice never collides with itself either.
  private generateBranchName(operationCode: string): string {
    const scope = operationCode.toLowerCase().replace(/_/g, '-');
    const shortId = randomBytes(4).toString('hex');
    return `codeguardian/${scope}/${shortId}`;
  }

  private isUnauthorized(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      (error.status === 401 || error.status === 403)
    );
  }

  private isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 404
    );
  }

  // Returns the existing file's content and blob sha, or null if the file
  // doesn't exist yet — a new README is not a special case (§ Agente Docs),
  // it's just a diff applied against an empty string with no sha to update.
  private async readExistingFile(
    token: string,
    owner: string,
    repo: string,
    path: string,
    baseSha: string,
  ): Promise<{ content: string; sha: string } | null> {
    try {
      const file = await this.githubClient.getFileContent(
        token,
        owner,
        repo,
        path,
        baseSha,
      );
      return { content: file.content, sha: file.sha };
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  // Opens a Pull Request carrying the agent's proposed single-file diff.
  // Throws AppException('PR_CREATION_FAILED') only for GitHub's own
  // authorization refusals (401/403) — every other failure (network,
  // GitHub 5xx, and a diff that fails to apply cleanly) is deliberately left
  // to propagate uncaught, so it falls through to UPSTREAM the same way
  // every other unclassified failure in this codebase does (see
  // CredentialsService.verifyGithubToken for the same pattern). A patch that
  // doesn't apply isn't a permissions problem and isn't expected to be
  // common enough to earn its own error code (mvp_backend_design.tex doesn't
  // name this case at all) — UPSTREAM is the documented fallback for exactly
  // this situation.
  async openPullRequestForProposal(
    token: string,
    owner: string,
    repo: string,
    baseBranch: string,
    change: ProposalChange,
  ): Promise<string> {
    const baseSha = await this.githubClient.resolveRefToSha(
      token,
      owner,
      repo,
      baseBranch,
    );

    const existing = await this.readExistingFile(
      token,
      owner,
      repo,
      change.targetPath,
      baseSha,
    );

    const newContent = applyPatch(existing?.content ?? '', change.diffUnified);
    if (newContent === false) {
      // Not GitHub's fault and not an authorization problem — see the
      // method-level comment above. Left uncaught on purpose.
      throw new Error(
        `Diff for ${change.targetPath} does not apply against the current file content (base ${baseSha}).`,
      );
    }

    const branchName = this.generateBranchName(change.operationCode);
    const client = this.writeClient(token);

    try {
      await client.request('POST /repos/{owner}/{repo}/git/refs', {
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      });

      await client.request('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path: change.targetPath,
        message: `Code Guardian: ${change.title}`,
        content: Buffer.from(newContent, 'utf8').toString('base64'),
        branch: branchName,
        sha: existing?.sha,
      });

      const { data } = await client.request(
        'POST /repos/{owner}/{repo}/pulls',
        {
          owner,
          repo,
          title: change.title,
          head: branchName,
          base: baseBranch,
          body: 'Opened automatically by Code Guardian. Review the diff before merging.',
        },
      );

      return data.html_url;
    } catch (error) {
      if (this.isUnauthorized(error)) {
        throw new AppException(
          'PR_CREATION_FAILED',
          'GitHub refused to open the Pull Request (missing permission or invalid token).',
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw error;
    }
  }
}
