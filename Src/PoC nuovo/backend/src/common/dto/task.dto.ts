import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsArray, IsEnum } from 'class-validator';
import type { OperationCode, TaskStatus } from './types.js';

const OPERATION_CODES = [
  'DOCS_README', 'DOCS_INLINE', 'DOCS_API', 
  'SECURITY_OWASP', 'SECURITY_POLICY', 
  'CHANGELOG_TECHNICAL', 'CHANGELOG_BUSINESS'
];

export class CreateTaskBatchDto {
  @ApiProperty({ example: '60d5ecb8b392d70015342345' })
  @IsString()
  @IsNotEmpty()
  contextId: string;

  @ApiProperty({ enum: OPERATION_CODES, isArray: true })
  @IsArray()
  @IsEnum(OPERATION_CODES, { each: true })
  @IsNotEmpty()
  operations: OperationCode[];
}

// Anche questo è un DTO di output
export class TaskDto {
  @ApiProperty() id: string;
  @ApiProperty() batchId: string;
  @ApiProperty({ enum: OPERATION_CODES }) operation: OperationCode;
  @ApiProperty() status: TaskStatus;
  @ApiProperty() progressPercent: number;
  @ApiProperty({ required: false }) currentStage: string | null;
  @ApiProperty({ required: false }) reportId: string | null;
  @ApiProperty({ required: false }) error: { code: string; message: string; stage: string } | null;
}