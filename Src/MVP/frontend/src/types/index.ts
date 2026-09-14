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
 * Which operations a role can launch is NOT a frontend constant: it is decided
 * by AgentRegistry on the backend, which is also what enforces it on POST
 * /tasks. Duplicating it here meant having two tables to keep aligned by hand,
 * with the only possible effect of showing the user an operation that the
 * backend will refuse with a 403. RunPage reads GET /operations.
 */

/** Human-readable label for each operation code (UI-only fallback). */
export const OPERATION_LABELS: Record<OperationCode, string> = {
  DOCS_README: "README Documentation",
  DOCS_INLINE: "Inline Documentation",
  DOCS_API: "API Documentation",
  SECURITY_OWASP: "OWASP Security Analysis",
  SECURITY_POLICY: "Policy Check",
  CHANGELOG_TECHNICAL: "Technical Changelog",
  CHANGELOG_BUSINESS: "Business Changelog",
};

// ---------------------------------------------------------------------------
