import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RepositoriesService } from './repositories.service';
import { RepoUrlQueryDto } from './dto/repo-url-query.dto';
import { RepoTreeQueryDto } from './dto/repo-tree-query.dto';
import { RefSummary, RepositorySummary } from '../github/github-client.types';
import { RepositoryTreeDto } from './dto/repository-tree.dto';

// Every route here is personal to the caller — no RolesGuard, just proof of
// identity, same shape as CredentialsController.
@Controller('repositories')
@UseGuards(JwtAuthGuard)
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Get()
  list(@CurrentUser('userId') userId: string): Promise<RepositorySummary[]> {
    return this.repositoriesService.list(userId);
  }

  @Get('refs')
  refs(
    @CurrentUser('userId') userId: string,
    @Query() query: RepoUrlQueryDto,
  ): Promise<RefSummary> {
    return this.repositoriesService.refs(userId, query.repoUrl);
  }

  @Get('tree')
  tree(
    @CurrentUser('userId') userId: string,
    @Query() query: RepoTreeQueryDto,
  ): Promise<RepositoryTreeDto> {
    return this.repositoriesService.tree(
      userId,
      query.repoUrl,
      query.branch,
      query.commitSha,
    );
  }
}
