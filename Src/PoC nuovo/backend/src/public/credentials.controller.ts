import { Controller, Post, Get, Delete, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiProperty, ApiBearerAuth, ApiTags } from '@nestjs/swagger'; 
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { CredentialVaultService } from '../internal/credential-vault.service.js';

export class SaveCredentialDto {
  @ApiProperty({ example: 'GITHUB', description: 'Il provider del token' })
  @IsString()
  @IsOptional()
  provider: string;

  @ApiProperty({ example: 'ghp_1234567890abcdef...', description: 'Il token personale (PAT)' })
  @IsString()
  @IsNotEmpty()
  token: string;
}

@ApiTags('Credentials') 
@ApiBearerAuth()        // Indica a Swagger che serve il lucchetto (token JWT)
@Controller('credentials')
@UseGuards(JwtAuthGuard)
export class CredentialsController {
  constructor(private readonly vaultService: CredentialVaultService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async saveCredential(
    @CurrentUser() userId: string,
    @Body() dto: SaveCredentialDto 
  ) {
    const provider = dto.provider || 'GITHUB';
    await this.vaultService.saveToken(userId, provider, dto.token);
    return { message: 'Credenziale salvata con successo' };
  }

@Get()
async getCredentials(@CurrentUser() userId: string) {
  return this.vaultService.listCredentials(userId);
}

@Post(':id/validate')
@HttpCode(HttpStatus.OK)
async validateCredential(@Param('id') id: string, @CurrentUser() userId: string) {
  return this.vaultService.validateToken(userId, id);
}

@Delete(':id')
@HttpCode(HttpStatus.NO_CONTENT)
async revokeCredential(@Param('id') id: string, @CurrentUser() userId: string) {
  await this.vaultService.revokeCredential(userId, id);
  return;
}
}