// AUTH
export type UserRole = "DEVELOPER" | "SECURITY_AUDITOR" | "PROJECT_MANAGER";
export const USER_ROLES: UserRole[] = ["DEVELOPER", "SECURITY_AUDITOR", "PROJECT_MANAGER"];

export interface RegisterDto {
  firstName: string; // 1-40 char
  lastName: string; // 1-40 char
  email: string; // validated, unique
  password: string; // 8 char min, at least 1 letter and 1 digit
  role: UserRole; // once chosen, permanent
}

export interface UserProfileDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
}

export interface AuthTokenDto {
  accessToken: string; // JWT HS256, expires in 8h
}

export interface LoginDto {
  email: string;
  password: string;
}

// OPERATIONS
export type OperationCode =
  | "DOCS_README"
  | "DOCS_INLINE"
  | "DOCS_API"
  | "SECURITY_OWASP"
  | "SECURITY_POLICY"
  | "CHANGELOG_TECHNICAL"
  | "CHANGELOG_BUSINESS";

export const OPERATION_CODES: OperationCode[] = [
  "DOCS_README",
  "DOCS_INLINE",
  "DOCS_API",
  "SECURITY_OWASP",
  "SECURITY_POLICY",
  "CHANGELOG_TECHNICAL",
  "CHANGELOG_BUSINESS",
];

export type AgentName = "DOCS" | "SECURITY" | "CHANGELOG";

// What GET /operations returns: only the operations permitted for the role of
// the caller, already filtered by the backend. It is the source of truth on
// which operations exist and who can launch them — the frontend does not
// duplicate it.
export interface OperationDescriptorDto {
  code: OperationCode;
  displayName: string;
  description: string;
  agent: AgentName;
}

export type ScopeType = "FULL_REPOSITORY" | "FILES" | "DIRECTORIES";
export const SCOPE_TYPES: ScopeType[] = ["FULL_REPOSITORY", "FILES", "DIRECTORIES"];

// TASKS
export type TaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface TaskError {
  code: string;
  message: string;
  stage: string;
}

export type PendingInput =
  | { kind: "SPRINT_ID" }
  | { kind: "INCOMPLETE_TASKS"; taskIds: string[] }
  // The technical changelog travels as text, not as a Report id.
  //
  // Here there was `technicalReportId`, and it could not work: CHANGELOG_BUSINESS
  // is a single Task that does two phases inside the same agent graph, and the
  // Report is born only at the end. At the moment confirmation is requested a
  // technical Report does not exist, so there is no id to send — the
  // interface used to build a link to `/reports/` on top of it.
  | {
      kind: "BUSINESS_CONFIRMATION";
      /** The technical changelog just produced, in Markdown. */
      technicalChangelog: string;
      /** True if the text was truncated because it was too long. */
      technicalChangelogTruncated: boolean;
    }
  | null;

export type SubmitInputDto =
  | { kind: "SPRINT_ID"; sprintId: string }
  | { kind: "INCOMPLETE_TASKS"; action: "PROCEED" | "CANCEL" }
  | { kind: "BUSINESS_CONFIRMATION"; action: "PROCEED" | "CANCEL" };

export interface CreateTaskBatchDto {
  contextId: string;
  operations: OperationCode[];
}

export interface TaskDto {
  id: string;
  batchId: string | null;
  operation: OperationCode;
  status: TaskStatus;
  progressPercent: number;
  currentStage: string | null;
  reportId: string | null;
  error: TaskError | null;
  pendingInput: PendingInput;
}

// REPORTS
export type ReportStatus = "COMPLETED" | "FAILED";
export type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// Note: Task uses `code`, Report uses `kind` for the same value domain.
// Deliberate divergence, kept (§11.2): they are two different documents, and
// the frontend already reads `error.code` on the Task by name.
export interface ReportError {
  kind: string;
  message: string;
  stage: string;
}

export interface ReportContext {
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  branch: string;
  resolvedSha: string;
  scopeType: ScopeType;
  paths: string[];
}

// Negative outcome of opening the Pull Request.
//
// It sits next to the diff and not in place of it: when publishing fails the
// agent's work is still complete, and discarding it over a GitHub permissions
// issue would mean making the user pay again for a successful analysis. The
// diff therefore stays in the Report, applicable by hand, and this field
// says why the PR link is not there.
//
// Same shape as ReportError (`kind` + `message`) because it is the same
// value domain: `kind` is always one of the ErrorKind values, in practice
// PR_CREATION_FAILED when GitHub rejects and CREDENTIAL_INVALID when the
// token is missing or invalid.
export interface ProposalPublishError {
  kind: string;
  message: string;
}

export interface Proposal {
  targetPath: string;
  diffUnified: string;
  language: string;
  pullRequestUrl: string | null;
  // Optional because the Proposal is born from the agent, which knows nothing
  // about publishing: it is the backend that populates one or the other of
  // these two fields right before Report assembly. Absent or null = no
  // failure to report.
  pullRequestError?: ProposalPublishError | null;
}

export interface ReportDto {
  id: string;
  taskId: string;
  operation: OperationCode;
  status: ReportStatus;
  title: string;
  summary: string | null;
  generatedAt: string;
  // Machine time accumulated from agent invocations (no queue wait or
  // human input wait). Name aligned with the persisted field on Report.
  durationMs: number | null;
  tokensConsumed: number;
  context: ReportContext;
  body: Block[];
  proposal?: Proposal;
  // Read-only projection of the owning Task's pendingInput.
  pendingAction: PendingInput;
  error?: ReportError;
}

export interface ReportSummaryDto {
  id: string;
  operation: OperationCode;
  status: ReportStatus;
  title: string;
  generatedAt: string;
  durationMs: number | null;
}

// `order` is emitted by the Python agents to make the order of blocks in a
// report deterministic; optional because a block built by the backend (or by
// an older agent) remains valid without it.
export interface TextBlock {
  kind: "TEXT";
  order?: number;
  markdown: string;
}

export interface FindingBlock {
  kind: "FINDING";
  order?: number;
  category: string;
  severity: Severity;
  filePath: string;
  lineStart: number;
  lineEnd?: number;
  description: string;
  remediation: Remediation;
}

export type Remediation =
  | { kind: "SNIPPET"; language: string; code: string }
  | { kind: "TEXT"; text: string };

export interface PolicyViolationBlock {
  kind: "POLICY_VIOLATION";
  order?: number;
  ruleId: string;
  ruleText: string;
  filePath: string;
  explanation: string;
  severity: Severity;
  remediation: Remediation;
}

export interface ComplexityWarningBlock {
  kind: "COMPLEXITY_WARNING";
  order?: number;
  severity: "INFO";
  filePath: string;
  lineStart: number;
  lineEnd: number;
  explanation: string;
}

export interface ChangelogItemBlock {
  kind: "CHANGELOG_ITEM";
  order?: number;
  issueRef: string;
  title: string;
  detail: string;
}

// ─────────────────────────── SAST Blocks (Semgrep) ───────────────────────────
//
// Produced by the static analysis phase that precedes the LLM in SECURITY_OWASP:
// Semgrep finds the candidates, the LLM judges them one by one. They remain
// distinct blocks from FindingBlock precisely because their source is
// different — a deterministic rule, not the model — and that information
// (which rule, which OWASP category, which CWE, and what the LLM said about it)
// is the reason a reviewer trusts the result or not.

/** What the LLM said about a finding raised by Semgrep. */
export type SastVerdict = "CONFIRMED" | "FALSE_POSITIVE" | "NEEDS_REVIEW";

/** Native Semgrep severity, kept for comparison with a raw scan. */
export type SastRuleSeverity = "ERROR" | "WARNING" | "INFO";

export interface SastFindingBlock {
  kind: "SAST_FINDING";
  order?: number;
  /** Identifier of the Semgrep rule that produced the finding. */
  ruleId: string;
  /** OWASP category from the rule metadata, "OWASP-UNKNOWN" if absent. */
  owaspCategory: string;
  cwe?: string;
  /**
   * Severity in the shared domain, so that the frontend filter and badge
   * work on these blocks as on all the others. Derived from
   * `ruleSeverity` (ERROR→HIGH, WARNING→MEDIUM, INFO→INFO).
   */
  severity: Severity;
  /** Severity as emitted by Semgrep, without remapping. */
  ruleSeverity: SastRuleSeverity;
  filePath: string;
  lineStart: number;
  message: string;
  /** Excerpt of the offending code, truncated by the analyser. */
  codeSnippet?: string;
  verdict: SastVerdict;
  /** Remediation suggested by the LLM during judgement; absent if not given. */
  llmRemediation?: string;
}

export interface SastSummaryBlock {
  kind: "SAST_SUMMARY";
  order?: number;
  totalFindings: number;
  confirmedFindings: number;
  falsePositives: number;
  needsReview: number;
  /** Findings excluded by the cap on those submitted to the LLM. */
  cappedFindings: number;
  scannedFiles: number;
  durationMs: number;
  /** True if Semgrep exceeded its own timeout: partial results. */
  timedOut: boolean;
}

export type Block =
  | TextBlock
  | FindingBlock
  | PolicyViolationBlock
  | ComplexityWarningBlock
  | ChangelogItemBlock
  | SastFindingBlock
  | SastSummaryBlock;

// CONTEXTS
export interface CreateContextDto {
  repoUrl: string;
  branch: string;
  commitSha?: string;
  scopeType: ScopeType;
  paths?: string[];
}

export interface AnalysisContextDto {
  id: string;
  repoOwner: string;
  repoName: string;
  isPrivate: boolean;
  branch: string;
  resolvedSha: string;
  scopeType: ScopeType;
  // Only the languages the agents can analyse, sorted by descending file
  // count.
  detectedLanguages: string[];
  // RF.24: programming languages present that the agents *cannot* analyse,
  // same ordering. Empty does not mean "empty repository": for that there
  // is estimatedFileCount.
  unsupportedLanguages: string[];
  // The language with the most files, supported or not; null if there is no code.
  predominantLanguage: string | null;
  // RV.7/RF.24: non-blocking warning, true when the predominant language
  // is not among the supported ones. Derived by the backend from the two
  // fields above and not stored, just as nonEnglishReadmeDetected is the
  // corresponding warning for RV.8.
  unsupportedLanguageWarning: boolean;
  estimatedFileCount: number;
  nonEnglishReadmeDetected: boolean;
}

// CREDENTIALS
export type CredentialsStatus = "UNKNOWN" | "MISSING" | "CONNECTED" | "INVALID";

export interface CreateCredentialDto {
  provider: string;
  // GITHUB: the Personal Access Token. SONARQUBE: the user token (SonarQube)
  // or the analysis/user token (SonarCloud).
  token: string;
  // SONARQUBE only, and all three required for it. Ignored for GITHUB.
  //   instanceUrl      — e.g. https://sonarcloud.io or a self-hosted URL
  //   projectKey       — the project's key on that instance
  //   organizationKey  — required by SonarCloud, omitted for self-hosted SonarQube
  instanceUrl?: string;
  projectKey?: string;
  organizationKey?: string;
}

export interface ServiceCredentialDto {
  id: string;
  provider: string;
  connectedAt: string; // ISO 8601
}

// WEB SOCKET EVENTS
export interface TaskUpdatedEvent {
  taskId: string;
  status: TaskStatus;
  reportId?: string;
}

export interface TaskProgressEvent {
  taskId: string;
  stage: string;
  percent: number;
}

export interface TaskFailedEvent {
  taskId: string;
  error: { code: string; message: string; stage: string };
}

export interface TaskInputRequiredEvent {
  taskId: string;
  kind: "SPRINT_ID" | "INCOMPLETE_TASKS" | "BUSINESS_CONFIRMATION";
  taskIds?: string[];
  // The technical changelog to review before the business phase, as text.
  // Not an id: see the comment on PendingInput above.
  technicalChangelog?: string;
  technicalChangelogTruncated?: boolean;
}

export interface BatchCompletedEvent {
  batchId: string;
  completed: number;
  failed: number;
}

// REPOSITORY
export interface RepositorySummary {
  owner: string;
  name: string;
  isPrivate: boolean;
  defaultBranch: string;
  primaryLanguage: string | null;
}

// TEMPLATE README (RF.79-RF.81)

/**
 * The state of a user's README template, as seen by the interface.
 *
 * `active: false` is not an error: it is the normal case for someone who has
 * never uploaded anything and is using the Docs Agent's default model. RF.81
 * also defines it as the state returned to after a removal.
 */
export interface ReadmeTemplateDto {
  active: boolean;
  filename: string | null;
  content: string | null;
  updatedAt: string | null;
}