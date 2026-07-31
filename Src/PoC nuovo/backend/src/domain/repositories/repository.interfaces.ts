import type { AnalysisContextDocument } from '../schemas/analysis-context.schema.js';
import type { AccessLogDocument } from '../schemas/access-log.schema.js';
import type { ServiceCredentialDocument } from '../schemas/service-credential.schema.js';

export const CONTEXT_REPOSITORY = 'IAnalysisContextRepository';
export const ACCESS_LOG_REPOSITORY = 'IAccessLogRepository';
export const CREDENTIAL_REPOSITORY = 'IServiceCredentialRepository';

export interface IAnalysisContextRepository {
  findById(id: string): Promise<AnalysisContextDocument | null>;
  create(contextData: Partial<AnalysisContextDocument>): Promise<AnalysisContextDocument>;
}

export interface IAccessLogRepository {
  logAccess(taskId: string, endpoint: string, resource: string): Promise<AccessLogDocument>;
}

export interface IServiceCredentialRepository {
  findByUserIdAndProvider(userId: string, provider: string): Promise<ServiceCredentialDocument | null>;
  upsertCredential(userId: string, provider: string, data: Partial<ServiceCredentialDocument>): Promise<void>;
  findAllByUserId(userId: string): Promise<ServiceCredentialDocument[]>;
  findById(userId: string, id: string): Promise<ServiceCredentialDocument | null>;
  deleteById(userId: string, id: string): Promise<boolean>;
}