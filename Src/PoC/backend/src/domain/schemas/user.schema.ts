import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum UserRole {
  DEVELOPER = 'DEVELOPER',
  SECURITY_AUDITOR = 'SECURITY_AUDITOR',
  PROJECT_MANAGER = 'PROJECT_MANAGER',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: String, enum: UserRole, default: UserRole.DEVELOPER })
  role: UserRole;
}

export const UserSchema = SchemaFactory.createForClass(User);