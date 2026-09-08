import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CredentialsService } from './credentials.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { ServiceCredentialDto } from './dto/service-credential.dto';

// Every route here is personal to the caller — no RolesGuard, just proof of
// identity via JwtAuthGuard, applied once at the controller level since
// nothing on this controller is public (unlike AuthController, which mixes
// public and protected routes).
@Controller('credentials')
@UseGuards(JwtAuthGuard)
export class CredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateCredentialDto,
  ): Promise<ServiceCredentialDto> {
    return this.credentialsService.create(userId, dto);
  }

  @Get()
  list(@CurrentUser('userId') userId: string): Promise<ServiceCredentialDto[]> {
    return this.credentialsService.list(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.credentialsService.remove(userId, id);
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  revalidate(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ): Promise<ServiceCredentialDto> {
    return this.credentialsService.revalidate(userId, id);
  }
}
