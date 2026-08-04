import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'; 
import { CreateContextDto } from '../common/dto/context.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RepositoryContextService } from '../internal/repository-context.service.js';

@ApiTags('Contexts')
@ApiBearerAuth() 
@Controller('contexts')
@UseGuards(JwtAuthGuard)
export class ContextController {
  constructor(private contextService: RepositoryContextService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createContext(@Body() dto: CreateContextDto, @CurrentUser() userId: string) {
    const saved = await this.contextService.buildContext(userId, dto);
    return { contextId: (saved as any)._id.toString() }; 
  }
}