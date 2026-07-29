import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import type { OperationCode, ReportStatus } from '../../common/dto/types.js';

export type ReportDocument = HydratedDocument<Report>;

@Schema({ timestamps: { createdAt: 'generatedAt', updatedAt: false } })
export class Report {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  taskId: Types.ObjectId;

  @Prop({ required: true })
  agentId: string;

  @Prop({ type: String, required: true })
operation: OperationCode;

  @Prop({ type: String, required: true })
  status: ReportStatus;

  @Prop()
  durationMs: number;

  @Prop()
  tokensConsumed: number;

  @Prop()
  summary: string;

  // Timeout ed errori non causano crash, restano nel contratto 
  @Prop({ type: Object })
  error: { kind: string; message: string; stage: string };

  // Mongoose schema mixed type per supportare il polimorfismo dei blocchi
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  body: any[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  proposal: any;
}

export const ReportSchema = SchemaFactory.createForClass(Report);