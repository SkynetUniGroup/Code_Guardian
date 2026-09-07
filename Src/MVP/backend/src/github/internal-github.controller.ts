import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ApiExcludeController } from "@nestjs/swagger";
import { type Model, Types } from "mongoose";
import { InternalAuthGuard } from "../common/guards/internal-auth.guard";
import type { InternalFileRequestDto } from "./dto/internal-file-request.dto";
import type { InternalIssuesRequestDto } from "./dto/internal-issues-request.dto";
import type { InternalTreeRequestDto } from "./dto/internal-tree-request.dto";
import type { GithubClientService } from "./github-client.service";
import type { FileContent, IssueDetail, IssueSummary, TreeNode } from "./github-client.types";
import {
  GET_FILE_CONTENT_ROUTE,
  GET_ISSUE_DETAIL_ROUTE,
  GET_TREE_ROUTE,
  LIST_ISSUES_ROUTE,
} from "./github-routes";
import type { InternalTaskContextResolver } from "./internal-task-context.resolver";
import { isReadOnlyEndpointAllowed } from "./read-only-endpoint-whitelist";
import { AccessLog, type AccessLogDocument } from "./schemas/access-log.schema";

// Not reachable from the frontend, not documented in the public Swagger doc
// (@ApiExcludeController), and only ever called by the agent service inside
// the Docker network — the three read-only tools an agent uses to look at a
// repository (PoC §6). Every call resolves owner/repo/commit/token from
// `taskId` alone (InternalTaskContextResolver) and leaves one AccessLog row
// behind — that log is what makes the read-only guarantee demonstrable
// rather than just asserted (RS.3).
@ApiExcludeController()
@Controller("internal/github")
@UseGuards(InternalAuthGuard)
export class InternalGithubController {
  constructor(
    private readonly resolver: InternalTaskContextResolver,
    private readonly github: GithubClientService,
    @InjectModel(AccessLog.name)
    private readonly accessLogModel: Model<AccessLogDocument>,
  ) {}

  @Post("tree")
  async tree(@Body() dto: InternalTreeRequestDto): Promise<TreeNode[]> {
    this.assertWhitelisted(GET_TREE_ROUTE);
    const { taskId, owner, repo, resolvedSha, token } = await this.resolver.resolve(dto.taskId);
    const result = await this.github.getTree(token, owner, repo, resolvedSha);
    await this.logAccess(taskId, "tree", `${owner}/${repo}@${resolvedSha}`);
    return result;
  }

  @Post("file")
  async file(@Body() dto: InternalFileRequestDto): Promise<FileContent> {
    this.assertWhitelisted(GET_FILE_CONTENT_ROUTE);
    const { taskId, owner, repo, resolvedSha, token } = await this.resolver.resolve(dto.taskId);
    const result = await this.github.getFileContent(token, owner, repo, dto.path, resolvedSha);
    await this.logAccess(taskId, "file", `${owner}/${repo}@${resolvedSha}:${dto.path}`);
    return result;
  }

  @Post("issues")
  async issues(@Body() dto: InternalIssuesRequestDto): Promise<IssueSummary[] | IssueDetail> {
    const { taskId, owner, repo, token } = await this.resolver.resolve(dto.taskId);

    if (dto.issueNumber !== undefined) {
      this.assertWhitelisted(GET_ISSUE_DETAIL_ROUTE);
      const result = await this.github.getIssueDetail(token, owner, repo, dto.issueNumber);
      await this.logAccess(taskId, "issues", `${owner}/${repo}#${dto.issueNumber}`);
      return result;
    }

    this.assertWhitelisted(LIST_ISSUES_ROUTE);
    const result = await this.github.listIssues(token, owner, repo, dto.state);
    await this.logAccess(
      taskId,
      "issues",
      dto.state ? `${owner}/${repo}?state=${dto.state}` : `${owner}/${repo}`,
    );
    return result;
  }

  private assertWhitelisted(route: string): void {
    if (!isReadOnlyEndpointAllowed(route)) {
      throw new Error(`Route "${route}" is not in the read-only whitelist`);
    }
  }

  private async logAccess(taskId: string, endpoint: string, resource: string): Promise<void> {
    await this.accessLogModel.create({
      taskId: new Types.ObjectId(taskId),
      endpoint,
      resource,
    });
  }
}
