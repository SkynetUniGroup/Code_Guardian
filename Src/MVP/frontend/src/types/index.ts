/**
 * Frontend-specific types and re-exports from shared package.
 * Shared API types are imported from @codeguardian/shared.
 */

// ===============================================
// RE-EXPORTS FROM SHARED PACKAGE
// ===============================================

// Re-export all types from shared
import type {
  // Auth
  UserRole,
  UserProfileDto,
  AuthTokenDto,
  RegisterDto,
  LoginDto,
  // Operations
  OperationCode,
  // Tasks
  TaskStatus,
  TaskError,
  PendingInput,
  TaskDto,
  CreateTaskBatchDto,
  SubmitInputDto,
  // Reports
  ReportStatus,
  Severity,
  ReportContext,
  Block,
  ReportDto as Report,
  ReportSummaryDto,
  Proposal,
  TextBlock,
  FindingBlock,
  PolicyViolationBlock,
  ComplexityWarningBlock,
  ChangelogItemBlock,
  Remediation,
  // Contexts
  CreateContextDto,
  AnalysisContextDto,
  // Credentials
  CredentialsStatus,
  CreateCredentialDto,
  ServiceCredentialDto,
  // Repository
  RepositorySummary,
  // WebSocket Events
  TaskUpdatedEvent,
  TaskProgressEvent,
  TaskFailedEvent,
  TaskInputRequiredEvent,
  BatchCompletedEvent,
} from "@codeguardian/shared";

export type {
  UserRole,
  UserProfileDto,
  AuthTokenDto,
  RegisterDto,
  LoginDto,
  OperationCode,
  TaskStatus,
  TaskError,
  PendingInput,
  TaskDto,
  CreateTaskBatchDto,
  SubmitInputDto,
  ReportStatus,
  Severity,
  ReportContext,
  Block,
  Report,
  ReportSummaryDto,
  Proposal,
  TextBlock,
  FindingBlock,
  PolicyViolationBlock,
  ComplexityWarningBlock,
  ChangelogItemBlock,
  Remediation,
  CreateContextDto,
  AnalysisContextDto,
  CredentialsStatus,
  CreateCredentialDto,
  ServiceCredentialDto,
  RepositorySummary,
  TaskUpdatedEvent,
  TaskProgressEvent,
  TaskFailedEvent,
  TaskInputRequiredEvent,
  BatchCompletedEvent,
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
 * Maps each role to the operations it is permitted to launch.
 * Source: Progettazione.pdf Table 10.
 */
export const ROLE_OPERATIONS: Record<UserRole, OperationCode[]> = {
  DEVELOPER: ["DOCS_README", "DOCS_INLINE", "DOCS_API", "CHANGELOG_TECHNICAL"],
  SECURITY_AUDITOR: ["SECURITY_OWASP", "SECURITY_POLICY"],
  PROJECT_MANAGER: ["CHANGELOG_TECHNICAL", "CHANGELOG_BUSINESS"],
};

/** Human-readable label for each operation code. */
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
