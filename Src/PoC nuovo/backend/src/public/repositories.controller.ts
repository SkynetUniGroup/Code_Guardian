import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { OctokitGitHubClient } from '../internal/github-client.service.js';

@Controller('repositories')
@UseGuards(JwtAuthGuard)
export class RepositoriesController {
  constructor(private readonly githubClient: OctokitGitHubClient) {}

  @Get()
  async getRepositories(@CurrentUser() userId: string) {
    const repos = await this.githubClient.listRepositories(userId);
    return repos.map((r: any) => ({
      owner: r.owner.login,
      name: r.name,
      isPrivate: r.private,
      defaultBranch: r.default_branch,
      primaryLanguage: r.language
    }));
  }

  @Get(':owner/:repo/refs')
  async getRefs(
    @CurrentUser() userId: string,
    @Param('owner') owner: string,
    @Param('repo') repo: string
  ) {
    return this.githubClient.listRefs(userId, owner, repo);
  }

  @Get(':owner/:repo/tree')
  async getTree(
    @CurrentUser() userId: string,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('ref') ref: string
  ) {
    const sha = await this.githubClient.resolveRefToSha(userId, owner, repo, ref);
    return this.githubClient.getTree(null, userId, owner, repo, sha);
  }
}