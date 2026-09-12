import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { ContextsService } from "./contexts.service";
import type { AnalysisContextDto } from "./dto/analysis-context.dto";
import type { CreateContextDto } from "./dto/create-context.dto";

@Controller("contexts")
@UseGuards(JwtAuthGuard)
export class ContextsController {
  constructor(private readonly contextsService: ContextsService) {}

  @Post()
  create(
    @CurrentUser("userId") userId: string,
    @Body() dto: CreateContextDto,
  ): Promise<AnalysisContextDto> {
    return this.contextsService.create(userId, dto);
  }
}
