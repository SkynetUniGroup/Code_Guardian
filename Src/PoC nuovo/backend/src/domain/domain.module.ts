import { Module } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';

// Import Schemas
import { Task, TaskSchema } from './schemas/task.schema.js';
import { AnalysisContext, AnalysisContextSchema } from './schemas/analysis-context.schema.js';
import { Report, ReportSchema } from './schemas/report.schema.js';
import { ServiceCredential, ServiceCredentialSchema } from './schemas/service-credential.schema.js';
import { User, UserSchema } from './schemas/user.schema.js';
import { AccessLog, AccessLogSchema } from './schemas/access-log.schema.js';

// Import Types
import type { AnalysisContextDocument } from './schemas/analysis-context.schema.js';
import type { ServiceCredentialDocument } from './schemas/service-credential.schema.js';
import type { AccessLogDocument } from './schemas/access-log.schema.js';

import { 
  CONTEXT_REPOSITORY, 
  CREDENTIAL_REPOSITORY, 
  ACCESS_LOG_REPOSITORY 
} from './repositories/repository.interfaces.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: AnalysisContext.name, schema: AnalysisContextSchema },
      { name: Report.name, schema: ReportSchema },
      { name: ServiceCredential.name, schema: ServiceCredentialSchema },
      { name: User.name, schema: UserSchema }, 
      { name: AccessLog.name, schema: AccessLogSchema }, 
    ]),
  ],
  providers: [
    {
      provide: CONTEXT_REPOSITORY,
      useFactory: (contextModel: Model<AnalysisContextDocument>) => ({
        create: async (data: Partial<AnalysisContextDocument>) => {
          const created = new contextModel(data);
          return created.save();
        },
        findById: async (id: string) => {
          return contextModel.findById(id).exec();
        },
      }),
      inject: [getModelToken(AnalysisContext.name)],
    },
    {
  provide: CREDENTIAL_REPOSITORY,
  useFactory: (credentialModel: Model<ServiceCredentialDocument>) => ({
    upsertCredential: async (userId: string, provider: string, data: Partial<ServiceCredentialDocument>) => {
      await credentialModel.updateOne(
        { userId, provider },
        { $set: data },
        { upsert: true }
      ).exec();
    },
    findByUserIdAndProvider: async (userId: string, provider: string) => {
      return credentialModel.findOne({ userId, provider }).exec();
    },
    findAllByUserId: async (userId: string) => {
      return credentialModel.find({ userId }).exec();
    },
    findById: async (userId: string, id: string) => {
      return credentialModel.findOne({ _id: id, userId }).exec();
    },
    deleteById: async (userId: string, id: string) => {
      const result = await credentialModel.deleteOne({ _id: id, userId }).exec();
      return result.deletedCount > 0;
    },
  }),
  inject: [getModelToken(ServiceCredential.name)],
},
    {
      provide: ACCESS_LOG_REPOSITORY,
      useFactory: (accessLogModel: Model<AccessLogDocument>) => ({
        logAccess: async (taskId: string, endpoint: string, resource: string) => {
          const log = new accessLogModel({ taskId, endpoint, resource });
          return log.save();
        }
      }),
      inject: [getModelToken(AccessLog.name)],
    }
  ],
  // Esportiamo i repository e il MongooseModule per l'utilizzo in altri moduli
  exports: [MongooseModule, CONTEXT_REPOSITORY, CREDENTIAL_REPOSITORY, ACCESS_LOG_REPOSITORY],
})
export class DomainModule {}