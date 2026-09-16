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
    summary: "Crea un contesto di analisi",
    description:
      "Risolve il riferimento in uno SHA (RF.17), rileva i linguaggi (RF.24) e fissa lo scope. E' il primo passo di ogni operazione.",
  })
  @ApiCreatedResponse({ type: AnalysisContextResponse })
  @ApiBadRequestResponse({
    description: "Corpo non valido, o scope incoerente con scopeType (RF.29).",
    type: ApiErrorResponse,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description: "Repository non raggiungibile con la credenziale salvata, o branch inesistente.",
    type: ApiErrorResponse,
  })
  @ApiUnprocessableEntityResponse({
    description: "Il commit indicato non appartiene al branch indicato (RF.17).",
    type: ApiErrorResponse,
  })
  create(
    @CurrentUser("userId") userId: string,
    @Body() dto: CreateContextDto,
  ): Promise<AnalysisContextDto> {
    return this.contextsService.create(userId, dto);
  }
}
