/**
 * Frontend-specific types and re-exports from shared package.
 * Shared API types are imported from @codeguardian/shared.
 */

// ===============================================
// RE-EXPORTS FROM SHARED PACKAGE
// ===============================================

// Re-export all types from shared
import type {
  AgentName,
  AnalysisContextDto,
  AuthTokenDto,
  BatchCompletedEvent,
  Block,
  ChangelogItemBlock,
  ComplexityWarningBlock,
  CreateContextDto,
  CreateCredentialDto,
  CreateTaskBatchDto,
  CredentialsStatus,
  FindingBlock,
  LoginDto,
  OperationCode,
  OperationDescriptorDto,
  PendingInput,
  PolicyViolationBlock,
  Proposal,
  ProposalPublishError,
  ReadmeTemplateDto,
  RegisterDto,
  Remediation,
  ReportDto as Report,
  ReportContext,
  ReportStatus,
  ReportSummaryDto,
  RepositorySummary,
  SastFindingBlock,
  SastRuleSeverity,
  SastSummaryBlock,
  SastVerdict,
  ServiceCredentialDto,
  Severity,
  SubmitInputDto,
  TaskDto,
  TaskError,
  TaskFailedEvent,
  TaskInputRequiredEvent,
  TaskProgressEvent,
  TaskStatus,
  TaskUpdatedEvent,
  TextBlock,
  UserProfileDto,
  UserRole,
} from "@codeguardian/shared";

export type {
  AgentName,
  AnalysisContextDto,
  AuthTokenDto,
  BatchCompletedEvent,
  Block,
  ChangelogItemBlock,
  ComplexityWarningBlock,
  CreateContextDto,
  CreateCredentialDto,
  CreateTaskBatchDto,
  CredentialsStatus,
  FindingBlock,
  LoginDto,
  OperationCode,
  OperationDescriptorDto,
  PendingInput,
  PolicyViolationBlock,
  Proposal,
  ProposalPublishError,
  ReadmeTemplateDto,
  RegisterDto,
  Remediation,
  Report,
  ReportContext,
  ReportStatus,
  ReportSummaryDto,
  RepositorySummary,
  SastFindingBlock,
  SastRuleSeverity,
  SastSummaryBlock,
  SastVerdict,
  ServiceCredentialDto,
  Severity,
  SubmitInputDto,
  TaskDto,
  TaskError,
  TaskFailedEvent,
  TaskInputRequiredEvent,
  TaskProgressEvent,
  TaskStatus,
  TaskUpdatedEvent,
  TextBlock,
  UserProfileDto,
  UserRole,
};

// Frontend-specific types
export type Task = TaskDto;
export interface TaskEntry extends TaskDto {
  contextId?: string;
}

// ===============================================
// FRONTEND-ONLY TYPES
// ===============================================

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** User data stored in session after login (subset of UserProfileDto). */
export interface AuthUser {
  id: string;
  firstName: string;
  role: UserRole;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Quali operazioni può lanciare un ruolo NON è una costante di frontend: la
 * decide AgentRegistry lato backend, che è anche chi la applica su POST /tasks.
 * Duplicarla qui significava avere due tabelle da tenere allineate a mano, con
 * l'unico effetto possibile di mostrare all'utente un'operazione che il
 * backend gli rifiuterà con un 403. RunPage legge GET /operations.
 */

/** Etichetta leggibile per ciascun codice operazione (fallback di sola UI). */
export const OPERATION_LABELS: Record<OperationCode, string> = {
  DOCS_README: "Documentazione README",
  DOCS_INLINE: "Documentazione Inline",
  DOCS_API: "Documentazione API",
  SECURITY_OWASP: "Analisi Sicurezza OWASP",
  SECURITY_POLICY: "Verifica Policy",
  CHANGELOG_TECHNICAL: "Changelog Tecnico",
  CHANGELOG_BUSINESS: "Changelog Business",
};

// ---------------------------------------------------------------------------
