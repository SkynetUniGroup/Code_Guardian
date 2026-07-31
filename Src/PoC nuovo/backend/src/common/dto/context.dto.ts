import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateIf, ArrayNotEmpty } from 'class-validator';
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
  @ValidateIf(o => o.scopeType !== 'FULL_REPOSITORY')
  @IsArray()
  @ArrayNotEmpty({ message: 'L\'array paths non può essere vuoto se scopeType non è FULL_REPOSITORY' })
  @IsString({ each: true })
  paths?: string[];

  @ApiProperty({ required: false, description: 'Nome della milestone/sprint per filtrare le issue su GitHub' })
  @IsString()
  @IsOptional()
  sprintId?: string;
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