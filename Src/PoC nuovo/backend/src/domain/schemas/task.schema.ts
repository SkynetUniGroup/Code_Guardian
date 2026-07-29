import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { OperationCode, TaskStatus } from '../../common/dto/types.js';

export type TaskDocument = HydratedDocument<Task>;

@Schema({ timestamps: true })
export class Task {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  batchId: string;

  @Prop({ type: Types.ObjectId, ref: 'AnalysisContext', required: true })
  contextId: Types.ObjectId;

  @Prop({ type: String, required: true })
  operation: OperationCode;

  @Prop({ type: String, required: true, default: 'PENDING' })
  status: TaskStatus;

  @Prop({ default: 0 })
  progressPercent: number;

  @Prop()
  currentStage: string;

  @Prop({ type: Types.ObjectId, ref: 'Report' })
  reportId: Types.ObjectId;

  @Prop({ type: Object })
  error: { code: string; message: string; stage: string };

  @Prop()
  finishedAt: Date;

  // Implementazione del vincolo di transizione di stato
  canTransitionTo(newStatus: TaskStatus): boolean {
    const transitions: Record<TaskStatus, TaskStatus[]> = {
      PENDING: ['RUNNING', 'CANCELLED'],
      RUNNING: ['COMPLETED', 'FAILED', 'CANCELLED'],
      COMPLETED: [], // Stato terminale
      FAILED: [],    // Stato terminale
      CANCELLED: [], // Stato terminale
    };
    return transitions[this.status]?.includes(newStatus) || false;
  }
}

export const TaskSchema = SchemaFactory.createForClass(Task);
TaskSchema.methods.canTransitionTo = Task.prototype.canTransitionTo;