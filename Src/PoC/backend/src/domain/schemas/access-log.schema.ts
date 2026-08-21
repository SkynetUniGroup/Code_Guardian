import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AccessLogDocument = HydratedDocument<AccessLog>;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AccessLog {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: false })
  taskId?: Types.ObjectId | string;

  @Prop({ required: true })
  endpoint: string;

  @Prop({ required: true })
  resource: string;
}

export const AccessLogSchema = SchemaFactory.createForClass(AccessLog);