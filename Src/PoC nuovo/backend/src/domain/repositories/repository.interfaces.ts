import type { TaskDocument } from '../schemas/task.schema.js';
import type { AnalysisContextDocument } from '../schemas/analysis-context.schema.js';
import type { ReportDocument } from '../schemas/report.schema.js';
import type { AccessLogDocument } from '../schemas/access-log.schema.js';
import type { ServiceCredentialDocument } from '../schemas/service-credential.schema.js';

/**
 * NOTA (decisione presa in fase di prima integrazione): ITaskRepository e
 * IReportRepository sono dichiarate per coerenza di stile con le altre entità
 * di dominio, ma NON sono ancora bindate come provider in DomainModule.
 * Task e Report sono oggi acceduti con @InjectModel(...) direttamente da
 * TaskController, ReportController e TaskProcessor.
 * Prima di usare @Inject(TASK_REPOSITORY) o @Inject(REPORT_REPOSITORY) in
 * nuovo codice: implementare prima il provider corrispondente in
 * domain.module.ts, seguendo lo stesso pattern di CONTEXT_REPOSITORY.
 */
export const TASK_REPOSITORY = 'ITaskRepository';
export const CONTEXT_REPOSITORY = 'IAnalysisContextRepository';
export const REPORT_REPOSITORY = 'IReportRepository';
export const ACCESS_LOG_REPOSITORY = 'IAccessLogRepository';
export const CREDENTIAL_REPOSITORY = 'IServiceCredentialRepository';

export interface ITaskRepository {
  findById(id: string): Promise<TaskDocument | null>;
  create(taskData: Partial<TaskDocument>): Promise<TaskDocument>;
  save(task: TaskDocument): Promise<TaskDocument>;
  findPendingTasks(): Promise<TaskDocument[]>;
}

export interface IAnalysisContextRepository {
  findById(id: string): Promise<AnalysisContextDocument | null>;
  create(contextData: Partial<AnalysisContextDocument>): Promise<AnalysisContextDocument>;
}

export interface IReportRepository {
  findById(id: string): Promise<ReportDocument | null>;
  create(reportData: Partial<ReportDocument>): Promise<ReportDocument>;
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