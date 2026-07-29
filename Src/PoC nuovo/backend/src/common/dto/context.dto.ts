import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';
import type { ScopeType } from './types.js';

export class CreateContextDto {
  @ApiProperty({ example: 'nestjs', description: 'Proprietario del repository' })
  @IsString()
  @IsNotEmpty()
  repoOwner: string;

  @ApiProperty({ example: 'nest', description: 'Nome del repository' })
  @IsString()
  @IsNotEmpty()
  repoName: string;

  @ApiProperty({ example: 'master', description: 'Branch, tag o SHA' })
  @IsString()
  @IsNotEmpty()
  ref: string; 

  @ApiProperty({ example: 'FULL_REPOSITORY', enum: ['FULL_REPOSITORY', 'FILES', 'DIRECTORIES'] })
  @IsString()
  @IsNotEmpty()
  scopeType: ScopeType;

  @ApiProperty({ required: false, type: [String], description: 'Richiesto se scopeType != FULL_REPOSITORY' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paths?: string[];
}

export class AnalysisContextDto {
  id: string;
  repoOwner: string;
  repoName: string;
  isPrivate: boolean;
  resolvedSha: string;
  scopeType: ScopeType;
  detectedLanguages: string[];
  estimatedFileCount: number;
}