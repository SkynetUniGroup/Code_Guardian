import { Injectable, Logger, Inject } from '@nestjs/common';
import { CredentialVaultService } from './credential-vault.service';
import { Octokit } from 'octokit';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ACCESS_LOG_REPOSITORY, type IAccessLogRepository } from '../domain/repositories/repository.interfaces.js';

const ALLOWED_ENDPOINTS = [
  'GET /user/repos',
  'GET /repos/{owner}/{repo}',
  'GET /repos/{owner}/{repo}/branches',
  'GET /repos/{owner}/{repo}/tags',
  'GET /repos/{owner}/{repo}/commits/{ref}',
  'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
  'GET /repos/{owner}/{repo}/contents/{path}',
  'GET /repos/{owner}/{repo}/issues',
] as const;

@Injectable()
export class OctokitGitHubClient {
  private readonly logger = new Logger(OctokitGitHubClient.name);

  private octokitInstances = new Map<string, { client: Octokit; expiresAt: number }>();

  constructor(
    private vault: CredentialVaultService,
    @InjectRedis() private readonly cache: Redis,
    @Inject(ACCESS_LOG_REPOSITORY) private accessLogRepo: IAccessLogRepository
  ) {}

  private async getOctokit(userId: string): Promise<Octokit> {
    const now = Date.now();
    const cached = this.octokitInstances.get(userId);
    
    if (cached && cached.expiresAt > now) {
      return cached.client;
    }

    const token = await this.vault.getDecryptedToken(userId, 'GITHUB');
    const client = new Octokit({ auth: token });
    
    this.octokitInstances.set(userId, { client, expiresAt: now + 60000 });
    
    return client;
  }

  private async executeSafely(taskId: string | null, userId: string, endpoint: string, params: any) {
    if (!(ALLOWED_ENDPOINTS as readonly string[]).includes(endpoint)) {
      throw new Error(`Endpoint non in whitelist: ${endpoint}`);
    }

    // 1. AccessLog Guard
    if (taskId) {
      await this.accessLogRepo.logAccess(taskId, endpoint, `${params.owner}/${params.repo}`);
    }

    const octokit = await this.getOctokit(userId);
    try {
      const response = await octokit.request(endpoint, params);
      
      // 2. Rate Limit Guard
      const remaining = parseInt(response.headers['x-ratelimit-remaining'] || '100', 10);
      if (remaining < 10) {
        this.logger.warn(`Rate limit in esaurimento (${remaining} rimanenti). Rallento l'esecuzione.`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      return response.data;
    } catch (error) {
      this.logger.error(`Errore GitHub API su ${endpoint}: ${error}`);
      throw error;
    }
  }

  async listRepositories(userId: string) { return this.executeSafely(null, userId, 'GET /user/repos', { sort: 'updated', per_page: 100 }); }
  async getRepoDetails(userId: string, owner: string, repo: string) { return this.executeSafely(null, userId, 'GET /repos/{owner}/{repo}', { owner, repo }); }
  async listRefs(userId: string, owner: string, repo: string) {
  const [branches, tags] = await Promise.all([
    this.executeSafely(null, userId, 'GET /repos/{owner}/{repo}/branches', { owner, repo, per_page: 100 }),
    this.executeSafely(null, userId, 'GET /repos/{owner}/{repo}/tags', { owner, repo, per_page: 100 }),
  ]);

  return {
    branches: (branches as any[]).map((b) => ({ name: b.name, sha: b.commit.sha })),
    tags: (tags as any[]).map((t) => ({ name: t.name, sha: t.commit.sha })),
  };
}
  async resolveRefToSha(userId: string, owner: string, repo: string, ref: string): Promise<string> {
      const data = await this.executeSafely(null, userId, 'GET /repos/{owner}/{repo}/commits/{ref}', { owner, repo, ref });
      return data.sha;
  }

  // NUOVE IMPLEMENTAZIONI REALI
  async getTree(taskId: string | null, userId: string, owner: string, repo: string, sha: string) {
    const data = await this.executeSafely(taskId, userId, 'GET /repos/{owner}/{repo}/git/trees/{tree_sha}', { owner, repo, tree_sha: sha, recursive: 1 });
    return data.tree.map((node: any) => ({
      path: node.path,
      type: node.type === 'tree' ? 'dir' : 'file',
      sizeBytes: node.size || 0
    }));
  }

  async getFileContent(taskId: string | null, userId: string, owner: string, repo: string, sha: string, path: string) {
    // 3. Cache Redis Guard
    const cacheKey = `github:file:${owner}:${repo}:${sha}:${path}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const data = await this.executeSafely(taskId, userId, 'GET /repos/{owner}/{repo}/contents/{path}', { owner, repo, path, ref: sha });
    
    // GitHub API restituisce il file in Base64
    const contentBuffer = Buffer.from(data.content, 'base64');
    const content = contentBuffer.toString('utf8');
    const extension = path.split('.').pop();
    
    const result = {
      path: data.path,
      content: content,
      sha: data.sha,
      language: extension === 'ts' ? 'typescript' : extension === 'py' ? 'python' : extension === 'js' ? 'javascript' : 'unknown'
    };

    await this.cache.set(cacheKey, JSON.stringify(result), 'EX', 86400);

    return result;
  }

  async listIssues(taskId: string | null, userId: string, owner: string, repo: string, filter: any) {
    const data = await this.executeSafely(taskId, userId, 'GET /repos/{owner}/{repo}/issues', { owner, repo, state: filter?.state || 'all' });
    

    return data.map((issue: any) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      labels: issue.labels.map((l: any) => l.name).join(','),
      milestone: issue.milestone?.title || null,
      closedAt: issue.closed_at,
      hasSufficientMetadata: !!issue.body && issue.body.length > 50
    }));
  }
}