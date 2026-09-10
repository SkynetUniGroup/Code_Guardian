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
  accessToken: string; // JWT HS256, espires in 8h
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

// Cosa restituisce GET /operations: le sole operazioni consentite al ruolo di
// chi chiama, gia' filtrate dal backend. È la fonte di verità su quali
// operazioni esistono e chi può lanciarle — il frontend non la duplica.
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
  | { kind: "BUSINESS_CONFIRMATION"; technicalReportId: string }
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

// Nota: Task usa `code`, Report usa `kind` per lo stesso dominio di valori.
// Divergenza voluta e mantenuta (§11.2): sono due documenti diversi, e il
// frontend legge già `error.code` sul Task per nome.
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

// Esito negativo dell'apertura della Pull Request.
//
// Sta accanto al diff e non al posto suo: quando la pubblicazione fallisce il
// lavoro dell'agente e' comunque completo, e buttarlo via per un problema di
// permessi su GitHub significherebbe far ripagare all'utente un'analisi
// riuscita. Il diff resta quindi nel Report, applicabile a mano, e questo
// campo dice perche' il collegamento alla PR non c'e'.
//
// Stessa forma di ReportError (`kind` + `message`) perche' e' lo stesso
// dominio di valori: `kind` e' sempre uno degli ErrorKind, in pratica
// PR_CREATION_FAILED quando e' GitHub a rifiutare e CREDENTIAL_INVALID quando
// manca o non vale il token.
export interface ProposalPublishError {
  kind: string;
  message: string;
}

export interface Proposal {
  targetPath: string;
  diffUnified: string;
  language: string;
  pullRequestUrl: string | null;
  // Opzionale perche' la Proposal nasce dall'agente, che non sa nulla della
  // pubblicazione: e' il backend a valorizzare l'uno o l'altro di questi due
  // campi subito prima dell'assemblaggio del Report. Assente o null = nessun
  // fallimento da segnalare.
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
  // Tempo macchina accumulato dagli invii all'agent (nessuna attesa in coda o
  // di input umano). Nome allineato al campo persistito su Report.
  durationMs: number | null;
  tokensConsumed: number;
  context: ReportContext;
  body: Block[];
  proposal?: Proposal;
  // Proiezione read-only del pendingInput del Task proprietario.
  pendingAction: PendingInput;
  error?: ReportError;
}

export interface ReportSummaryDto {
  id: string;
  operation: OperationCode;
  status: ReportStatus;
  title: string;
  generatedAt: string;
}

// `order` è emesso dagli agent Python per rendere deterministico l'ordine dei
// blocchi in un report; opzionale perché un blocco costruito dal backend (o da
// un agent più vecchio) resta valido senza.
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

// ─────────────────────────── Blocchi SAST (Semgrep) ───────────────────────────
//
// Prodotti dalla fase di analisi statica che precede l'LLM in SECURITY_OWASP:
// Semgrep trova i candidati, l'LLM li giudica uno per uno. Restano blocchi
// distinti dai FindingBlock proprio perché la loro provenienza è diversa — una
// regola deterministica, non il modello — e quell'informazione (quale regola,
// quale categoria OWASP, quale CWE, e cosa ne ha detto l'LLM) è il motivo per
// cui un revisore si fida o no del risultato.

/** Cosa ha detto l'LLM di un finding sollevato da Semgrep. */
export type SastVerdict = "CONFIRMED" | "FALSE_POSITIVE" | "NEEDS_REVIEW";

/** Severità nativa di Semgrep, conservata per confronto con una scansione grezza. */
export type SastRuleSeverity = "ERROR" | "WARNING" | "INFO";

export interface SastFindingBlock {
  kind: "SAST_FINDING";
  order?: number;
  /** Identificativo della regola Semgrep che ha prodotto il finding. */
  ruleId: string;
  /** Categoria OWASP dai metadati della regola, "OWASP-UNKNOWN" se assente. */
  owaspCategory: string;
  cwe?: string;
  /**
   * Severità nel dominio condiviso, così che filtro e badge del frontend
   * funzionino su questi blocchi come su tutti gli altri. Derivata da
   * `ruleSeverity` (ERROR→HIGH, WARNING→MEDIUM, INFO→INFO).
   */
  severity: Severity;
  /** Severità così come l'ha emessa Semgrep, senza rimappature. */
  ruleSeverity: SastRuleSeverity;
  filePath: string;
  lineStart: number;
  message: string;
  /** Estratto del codice incriminato, troncato dall'analizzatore. */
  codeSnippet?: string;
  verdict: SastVerdict;
  /** Rimedio suggerito dall'LLM in fase di giudizio; assente se non l'ha dato. */
  llmRemediation?: string;
}

export interface SastSummaryBlock {
  kind: "SAST_SUMMARY";
  order?: number;
  totalFindings: number;
  confirmedFindings: number;
  falsePositives: number;
  needsReview: number;
  /** Finding esclusi dal tetto di quelli sottoposti all'LLM. */
  cappedFindings: number;
  scannedFiles: number;
  durationMs: number;
  /** True se Semgrep ha superato il proprio timeout: risultati parziali. */
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
  // Solo i linguaggi che gli agenti sanno analizzare, ordinati per numero di
  // file decrescente.
  detectedLanguages: string[];
  // RF.24: i linguaggi di programmazione presenti che gli agenti *non* sanno
  // analizzare, stesso ordinamento. Vuoto non vuol dire "repository vuoto":
  // per quello c'e' estimatedFileCount.
  unsupportedLanguages: string[];
  // Il linguaggio con piu' file, supportato o meno; null se non c'e' codice.
  predominantLanguage: string | null;
  // RV.7/RF.24: avviso non bloccante, vero quando il linguaggio predominante
  // non e' fra quelli supportati. Ricavato dal backend dai due campi qui sopra
  // e non memorizzato, cosi' come nonEnglishReadmeDetected e' l'avviso
  // corrispondente per RV.8.
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
  // Report del changelog tecnico da rivedere prima della fase business.
  // Nome distinto da `reportId` (task.updated), che è il report finale.
  technicalReportId?: string;
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
 * Lo stato del template README di un utente, come lo vede l'interfaccia.
 *
 * `active: false` non e' un errore: e' il caso normale di chi non ha mai
 * caricato nulla e sta usando il modello di default dell'Agente Docs. RF.81
 * lo definisce anche come lo stato in cui si torna dopo una rimozione.
 */
export interface ReadmeTemplateDto {
  active: boolean;
  filename: string | null;
  content: string | null;
  updatedAt: string | null;
}
