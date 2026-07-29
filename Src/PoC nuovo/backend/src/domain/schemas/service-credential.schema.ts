import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ServiceCredentialDocument = HydratedDocument<ServiceCredential>;

@Schema({ timestamps: true })
export class ServiceCredential {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, default: 'GITHUB' })
  provider: string;

  @Prop({ required: true })
  ciphertext: string;

  @Prop({ required: true })
  iv: string;

  @Prop({ required: true })
  authTag: string;

  @Prop({ required: true })
  salt: string; 
}

export const ServiceCredentialSchema = SchemaFactory.createForClass(ServiceCredential);