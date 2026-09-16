import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import {
  ApiErrorResponse,
  RefSummaryResponse,
  RepositorySummaryResponse,
  RepositoryTreeResponse,
} from "../common/openapi/api-schemas";
import type { RefSummary, RepositorySummary } from "../github/github-client.types";
import { RepoTreeQueryDto } from "./dto/repo-tree-query.dto";
import { RepoUrlQueryDto } from "./dto/repo-url-query.dto";
import type { RepositoryTreeDto } from "./dto/repository-tree.dto";
import { RepositoriesService } from "./repositories.service";

// Every route here is personal to the caller — no RolesGuard, just proof of
// identity, same shape as CredentialsController.
@ApiTags("repositories")
@ApiBearerAuth()
@Controller("repositories")
@UseGuards(JwtAuthGuard)
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Get()
  @ApiOperation({
    summary: "I repository visibili alla credenziale GitHub di chi chiama",
  })
  @ApiOkResponse({ type: [RepositorySummaryResponse] })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description: "Nessuna credenziale GitHub salvata per questo utente.",
    type: ApiErrorResponse,
  })
  list(@CurrentUser("userId") userId: string): Promise<RepositorySummary[]> {
    return this.repositoriesService.list(userId);
  }

  @Get("refs")
  @ApiOperation({ summary: "Branch e tag di un repository" })
  @ApiOkResponse({ type: RefSummaryResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description:
      "Credenziale GitHub assente, oppure repository non raggiungibile con quella salvata. GitHub risponde 404 sia per un repository inesistente sia per uno che il token non puo' vedere, e i due casi non sono distinguibili da qui.",
    type: ApiErrorResponse,
  })
  refs(
    @CurrentUser("userId") userId: string,
    @Query() query: RepoUrlQueryDto,
  ): Promise<RefSummary> {
    return this.repositoriesService.refs(userId, query.repoUrl);
  }

  @Get("tree")
  @ApiOperation({
    summary: "L'albero dei file a un dato riferimento",
    description: "Con commitSha omesso si usa l'HEAD corrente del branch.",
  })
  @ApiOkResponse({ type: RepositoryTreeResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description: "Credenziale GitHub assente, oppure repository o riferimento non raggiungibili.",
    type: ApiErrorResponse,
  })
  tree(
    @CurrentUser("userId") userId: string,
    @Query() query: RepoTreeQueryDto,
  ): Promise<RepositoryTreeDto> {
    return this.repositoriesService.tree(userId, query.repoUrl, query.branch, query.commitSha);
  }
}
