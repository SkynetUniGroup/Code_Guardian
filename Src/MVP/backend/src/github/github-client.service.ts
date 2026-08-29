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
  TreeNode,
} from './github-client.types';
import { backoffIfRateLimited } from './rate-limit-backoff';

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

function detectLanguage(path: string): string {
  const extension = path.split('.').pop();
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'py':
      return 'python';
    default:
      return 'unknown';
  }
}

// Content at a fixed commit SHA never changes, so caching it can never serve
// stale data — this TTL is only about not letting Redis hold entries forever
// for repos nobody re-reads, not a correctness concern.
const CACHE_TTL_SECONDS = 24 * 60 * 60;

// Every method takes the caller's decrypted token directly and builds a
// fresh Octokit client with it — this class never looks up or decrypts a
// credential itself, and never enforces which endpoints are reachable or
// logs calls to an AccessLog. That's BE-8's job, scoped specifically to the
// agent-facing internal endpoints (RS.3). The Redis cache and the rate-limit
// backoff below apply here instead, to every caller alike — the backend's
// own direct calls (BE-6, BE-9 through BE-12) never pass through BE-8 at
// all, and both controls protect a resource (the GitHub quota, the cache)
// that's shared regardless of who's asking.
@Injectable()
export class GithubClientService {
  private readonly logger = new Logger(GithubClientService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  private client(token: string): Octokit {
    const octokit = new Octokit({ auth: token });
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

    const { data } = await this.client(token).request(
      'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
      { owner, repo, tree_sha: sha, recursive: '1' },
    );

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

    const { data } = await this.client(token).request(
      'GET /repos/{owner}/{repo}/contents/{path}',
      { owner, repo, path, ref },
    );

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

  async listIssues(
    token: string,
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'all',
  ): Promise<IssueSummary[]> {
    const { data } = await this.client(token).request(
      'GET /repos/{owner}/{repo}/issues',
      { owner, repo, state, per_page: 100 },
    );

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
    const { data } = await this.client(token).request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}',
      { owner, repo, issue_number: issueNumber },
    );

    return {
      ...this.toIssueSummary(data),
      body: data.body ?? '',
    };
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
