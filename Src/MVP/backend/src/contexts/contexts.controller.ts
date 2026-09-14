import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AnalysisContextResponse, ApiErrorResponse } from "../common/openapi/api-schemas";
import { ContextsService } from "./contexts.service";
import type { AnalysisContextDto } from "./dto/analysis-context.dto";
import { CreateContextDto } from "./dto/create-context.dto";

@ApiTags("contexts")
@ApiBearerAuth()
@Controller("contexts")
@UseGuards(JwtAuthGuard)
export class ContextsController {
  constructor(private readonly contextsService: ContextsService) {}

  @Post()
  @ApiOperation({
    summary: "Create an analysis context",
    description:
      "Resolves the reference to a SHA (RF.17), detects languages (RF.24) and sets the scope. It is the first step of every operation.",
  })
  @ApiCreatedResponse({ type: AnalysisContextResponse })
  @ApiBadRequestResponse({
    description: "Invalid body, or scope inconsistent with scopeType (RF.29).",
    type: ApiErrorResponse,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description: "Repository unreachable with the saved credential, or non-existent branch.",
    type: ApiErrorResponse,
  })
  @ApiUnprocessableEntityResponse({
    description: "The indicated commit does not belong to the indicated branch (RF.17).",
    type: ApiErrorResponse,
  })
  create(
    @CurrentUser("userId") userId: string,
    @Body() dto: CreateContextDto,
  ): Promise<AnalysisContextDto> {
    return this.contextsService.create(userId, dto);
  }
}
