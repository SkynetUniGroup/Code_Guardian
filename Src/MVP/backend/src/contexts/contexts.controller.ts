import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ContextsService } from './contexts.service';
import { CreateContextDto } from './dto/create-context.dto';
import { AnalysisContextDto } from './dto/analysis-context.dto';

@Controller('contexts')
@UseGuards(JwtAuthGuard)
export class ContextsController {
  constructor(private readonly contextsService: ContextsService) {}

  @Post()
  create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateContextDto,
  ): Promise<AnalysisContextDto> {
    return this.contextsService.create(userId, dto);
  }
}
