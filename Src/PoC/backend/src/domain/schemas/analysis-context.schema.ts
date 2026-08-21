import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { ScopeType } from '../../common/dto/types.js';

export type AnalysisContextDocument = HydratedDocument<AnalysisContext>;

@Schema({ timestamps: true })
export class AnalysisContext {
  @Prop({ required: true })
  userId: string; // Utente proprietario

  @Prop({ required: true })
  repoOwner: string;

  @Prop({ required: true })
  repoName: string;

  @Prop({ required: true })
  isPrivate: boolean;

  @Prop({ required: true })
  resolvedSha: string; // Il pinning per garantire la riproducibilità

  @Prop({ type: String, required: true, enum: ['FULL_REPOSITORY', 'FILES', 'DIRECTORIES'] })
  scopeType: ScopeType;

  @Prop({ type: [String], default: [] })
  paths: string[];

  @Prop({ type: [String], default: [] })
  detectedLanguages: string[];

  @Prop()
  estimatedFileCount: number;

  @Prop()
  sprintId?: string;
}

export const AnalysisContextSchema = SchemaFactory.createForClass(AnalysisContext);