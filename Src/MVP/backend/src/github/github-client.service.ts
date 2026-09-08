import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Octokit } from '@octokit/rest';
import {
  CompareResult,
  CompareStatus,
  FileContent,
  IssueDetail,
  IssueSummary,
  NodeType,
  RefSummary,
  RepositorySummary,
  TokenVerification,
  TreeNode,
} from './github-client.types';
import { backoffIfRateLimited } from './rate-limit-backoff';
import { detectLanguage } from './language-detection';
import { OCTOKIT_TIMEOUT_MS } from './octokit-timeout';
import {
  GET_TREE_ROUTE,
  GET_FILE_CONTENT_ROUTE,
  LIST_ISSUES_ROUTE,
  GET_ISSUE_DETAIL_ROUTE,
  GET_README_ROUTE,
} from './github-routes';

// Declared return types, not inline `as` casts: a bare ternary here would
// infer as plain `string`, and a cast is exactly what eslint's
// no-unnecessary-type-assertion rule will silently strip on the next --fix
// even when it's still needed — it already did once (getTree's node type).
function toNodeType(githubType: string): NodeType {
  return githubType === 'tree' ? 'dir' : 'file';
}

function toCompareStatus(githubStatus: string): CompareStatus {
  if (
    githubStatus === 'ahead' ||
    githubStatus === 'behind' ||
    githubStatus === 'identical' ||
    githubStatus === 'diverged'
  ) {
    return githubStatus;
  }
  throw new Error(`Unexpected compare status from GitHub: ${githubStatus}`);
}

// Content at a fixed commit SHA never changes, so caching it can never serve
// stale data — this TTL is only about not letting Redis hold entries forever
// for repos nobody re-reads, not a correctness concern.
const CACHE_TTL_SECONDS = 24 * 60 * 60;

// Every method takes the caller's decrypted token directly and builds a
// fresh Octokit client with it — this class never looks up or decrypts a
// credential itself. RS.3 constrains only autonomous agents, not the
// backend's own calls (mvp_backend_design.tex §GitHub Integration), so the
// whitelist and AccessLog live in BE-8's InternalGithubController instead,
// scoped to the requests agents actually route through that facade — not
// here, where compareCommits/verifyToken/listRepositories/getRepository are
// backend-direct and outside that perimeter. The Redis cache and rate-limit
// backoff below do apply here, to every caller alike, since they protect a
// resource (the GitHub quota, the cache) shared regardless of who's asking.
@Injectable()
export class GithubClientService {
  private readonly logger = new Logger(GithubClientService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  private client(token: string): Octokit {
    const octokit = new Octokit({
      auth: token,
      request: { signal: AbortSignal.timeout(OCTOKIT_TIMEOUT_MS) },
    });
    octokit.hook.before('request', (options) => {
      if (options.method !== 'GET') {
        throw new Error(
          `GithubClientService: refusing a non-GET request (${options.method} ${options.url})`,
        );
      }
    });
    octokit.hook.after('request', async (response) => {
      await backoffIfRateLimited(response.headers, (remaining) =>
        this.logger.warn(
          `GitHub rate limit running low (${remaining} remaining) — slowing down`,
        ),
      );
    });
    return octokit;
  }

  async listRepositories(token: string): Promise<RepositorySummary[]> {
    const { data } = await this.client(token).request('GET /user/repos', {
      sort: 'updated',
      per_page: 100,
    });
    return data.map((repo) => this.toRepositorySummary(repo));
  }

  async getRepository(
    token: string,
    owner: string,
    repo: string,
  ): Promise<RepositorySummary> {
    const { data } = await this.client(token).request(
      'GET /repos/{owner}/{repo}',
      { owner, repo },
    );
    return this.toRepositorySummary(data);
  }

  async listRefs(
    token: string,
    owner: string,
    repo: string,
  ): Promise<RefSummary> {
    const client = this.client(token);
    const [branches, tags] = await Promise.all([
      client.request('GET /repos/{owner}/{repo}/branches', {
        owner,
        repo,
        per_page: 100,
      }),
      client.request('GET /repos/{owner}/{repo}/tags', {
        owner,
        repo,
        per_page: 100,
      }),
    ]);

    return {
      branches: branches.data.map((b) => ({
        name: b.name,
        sha: b.commit.sha,
      })),
      tags: tags.data.map((t) => ({ name: t.name, sha: t.commit.sha })),
    };
  }

  async resolveRefToSha(
    token: string,
    owner: string,
    repo: string,
    ref: string,
  ): Promise<string> {
    const { data } = await this.client(token).request(
      'GET /repos/{owner}/{repo}/commits/{ref}',
      { owner, repo, ref },
    );
    return data.sha;
  }

  // `sha` must already be a resolved commit SHA, never a branch/tag name —
  // the cache below is keyed on it and kept for 24h on the assumption that
  // content at that key is immutable. A caller passing a branch name would
  // silently serve stale content for up to 24h once that branch moves.
  async getTree(
    token: string,
    owner: string,
    repo: string,
    sha: string,
  ): Promise<TreeNode[]> {
    const cacheKey = `github:tree:${owner}/${repo}@${sha}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as TreeNode[];
    }

    const { data } = await this.client(token).request(GET_TREE_ROUTE, {
      owner,
      repo,
      tree_sha: sha,
      recursive: '1',
    });

    // Submodule entries (type "commit") aren't selectable per the design
    // (§ Ambito di analisi) — excluded here rather than forced into a
    // file/dir type that would misrepresent them.
    const tree = data.tree
      .filter((node) => node.type === 'blob' || node.type === 'tree')
      .map((node) => ({
        path: node.path ?? '',
        type: toNodeType(node.type),
        sizeBytes: node.size ?? 0,
      }));

    await this.redis.set(
      cacheKey,
      JSON.stringify(tree),
      'EX',
      CACHE_TTL_SECONDS,
    );
    return tree;
  }

  // Same caching assumption as getTree: `ref` must already be a resolved
  // commit SHA, not a branch/tag name, or the 24h cache can serve stale
  // content once the branch moves.
  async getFileContent(
    token: string,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<FileContent> {
    const cacheKey = `github:file:${owner}/${repo}@${ref}:${path}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as FileContent;
    }

    const { data } = await this.client(token).request(GET_FILE_CONTENT_ROUTE, {
      owner,
      repo,
      path,
      ref,
    });

    if (Array.isArray(data) || data.type !== 'file' || !data.content) {
      throw new Error(`${path} is not a readable file at ${ref}`);
    }

    const content = Buffer.from(data.content, 'base64').toString('utf8');
    const file: FileContent = {
      path: data.path,
      content,
      sha: data.sha,
      language: detectLanguage(data.path),
    };

    await this.redis.set(
      cacheKey,
      JSON.stringify(file),
      'EX',
      CACHE_TTL_SECONDS,
    );
    return file;
  }

  // GitHub's dedicated README endpoint, not a guess at a filename: it
  // resolves whichever README GitHub itself recognizes for the repo
  // (README.md, Readme.rst, README, ...), so this never has to enumerate
  // naming conventions itself. Returns null when the repo has none —
  // absence isn't an error here, just "nothing to check" for RV.8.
  async getReadme(
    token: string,
    owner: string,
    repo: string,
    ref: string,
  ): Promise<FileContent | null> {
    const cacheKey = `github:readme:${owner}/${repo}@${ref}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as FileContent | null;
    }

    let file: FileContent | null;
    try {
      const { data } = await this.client(token).request(GET_README_ROUTE, {
        owner,
        repo,
        ref,
      });
      const content = Buffer.from(data.content, 'base64').toString('utf8');
      file = {
        path: data.path,
        content,
        sha: data.sha,
        language: detectLanguage(data.path),
      };
    } catch (error) {
      if (this.isNotFound(error)) {
        file = null;
      } else {
        throw error;
      }
    }

    await this.redis.set(
      cacheKey,
      JSON.stringify(file),
      'EX',
      CACHE_TTL_SECONDS,
    );
    return file;
  }

  private isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 404
    );
  }

  async listIssues(
    token: string,
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'all',
  ): Promise<IssueSummary[]> {
    const { data } = await this.client(token).request(LIST_ISSUES_ROUTE, {
      owner,
      repo,
      state,
      per_page: 100,
    });

    // This endpoint returns pull requests too; PRs carry a `pull_request`
    // field that plain issues don't.
    return data
      .filter((issue) => !issue.pull_request)
      .map((issue) => this.toIssueSummary(issue));
  }

  async getIssueDetail(
    token: string,
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<IssueDetail> {
    const { data } = await this.client(token).request(GET_ISSUE_DETAIL_ROUTE, {
      owner,
      repo,
      issue_number: issueNumber,
    });

    return {
      ...this.toIssueSummary(data),
      body: data.body ?? '',
    };
  }

  // Checks that a token is accepted by GitHub and reports what it's allowed
  // to do — used by BE-6 before a credential is ever persisted, and again
  // whenever it's re-validated. `GET /user` is used because it works for any
  // valid token without needing to know a specific repository up front;
  // GitHub reports a classic token's granted scopes on the X-OAuth-Scopes
  // response header regardless of which endpoint you call.
  //
  // That header is classic-PAT-only: fine-grained tokens (`github_pat_...`)
  // don't use OAuth scopes at all, so this always comes back `scopes: []`
  // for one, valid or not — that's expected, not a bug here. It's the
  // caller's job to know which kind of token it's looking at before
  // deciding what an empty scope list means (see CredentialsService).
  //
  // A 401 here means the token itself is bad or revoked — the caller is
  // responsible for treating that differently from a network failure or
  // GitHub outage (§4.2, RS.4): this method doesn't catch anything itself,
  // it just relays what happened.
  async verifyToken(token: string): Promise<TokenVerification> {
    const { headers } = await this.client(token).request('GET /user');
    const scopesHeader = headers['x-oauth-scopes'] ?? '';
    const scopes = scopesHeader
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);
    return { scopes };
  }

  async compareCommits(
    token: string,
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<CompareResult> {
    const { data } = await this.client(token).request(
      'GET /repos/{owner}/{repo}/compare/{basehead}',
      { owner, repo, basehead: `${base}...${head}` },
    );
    return { status: toCompareStatus(data.status) };
  }

  private toRepositorySummary(repo: {
    owner: { login: string };
    name: string;
    private: boolean;
    default_branch: string;
    language: string | null;
  }): RepositorySummary {
    return {
      owner: repo.owner.login,
      name: repo.name,
      isPrivate: repo.private,
      defaultBranch: repo.default_branch,
      primaryLanguage: repo.language,
    };
  }

  private toIssueSummary(issue: {
    number: number;
    title: string;
    state: string;
    labels: (string | { name?: string })[];
    milestone: { title: string } | null;
    closed_at: string | null;
    body?: string | null;
  }): IssueSummary {
    return {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      labels: issue.labels.map((l) =>
        typeof l === 'string' ? l : (l.name ?? ''),
      ),
      milestone: issue.milestone?.title ?? null,
      closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
      hasSufficientMetadata: !!issue.body && issue.body.length > 50,
    };
  }
}
