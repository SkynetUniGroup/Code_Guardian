/**
 * Classi-schema per il documento OpenAPI.
 *
 * Perche' esistono: le risposte di questo backend sono `interface` condivise
 * con il frontend (`@codeguardian/shared`), e un'interfaccia TypeScript sparisce
 * alla compilazione — Swagger non ha nulla da leggere, e ogni risposta finiva
 * nel documento come codice di stato piu' descrizione vuota, senza `content`.
 *
 * Perche' cosi' e non con il plugin di @nestjs/swagger: il plugin gira solo
 * dentro `nest build` e deduce le proprieta' dai tipi *concreti*, quindi non
 * risolverebbe comunque le interfacce, e produrrebbe un documento diverso da
 * quello generato dai test — che il plugin non lo eseguono affatto. Queste
 * classi sono invece le stesse nei due percorsi.
 *
 * Ogni classe dichiara `implements` sull'interfaccia che rispecchia: se un
 * campo viene aggiunto o rinominato di la', qui la compilazione si rompe. E'
 * l'unica cosa che tiene allineati documento e realta' senza doverselo
 * ricordare.
 */

import type {
  AnalysisContextDto,
  AuthTokenDto,
  ChangelogItemBlock,
  ComplexityWarningBlock,
  CredentialsStatus,
  FindingBlock,
  OperationDescriptorDto,
  PolicyViolationBlock,
  Proposal,
  ProposalPublishError,
  ReportContext,
  ReportDto,
  ReportError,
  ReportStatus,
  ReportSummaryDto,
  SastFindingBlock,
  SastRuleSeverity,
  SastSummaryBlock,
  SastVerdict,
  ScopeType,
  ServiceCredentialDto,
  Severity,
  TaskDto,
  TaskError,
  TaskStatus,
  TextBlock,
  UserProfileDto,
  UserRole,
} from "@codeguardian/shared";
import { ApiExtraModels, ApiProperty, getSchemaPath } from "@nestjs/swagger";
import type {
  RefEntry,
  RefSummary,
  RepositorySummary,
  TreeNode,
} from "../../github/github-client.types";
import type { CreateTaskBatchResult } from "../../tasks/tasks.service";
import type { OperationCode } from "../domain-types";

// ─────────────────────────────── Errori ───────────────────────────────

export class ApiErrorResponse {
  @ApiProperty({
    type: String,
    description:
      "Codice del dominio degli errori, non un sinonimo dello stato HTTP: VALIDATION_ERROR, UNAUTHORIZED, NOT_FOUND, CONFLICT, PR_CREATION_FAILED, UPSTREAM…",
    example: "VALIDATION_ERROR",
  })
  code!: string;

  @ApiProperty({ type: String, example: "Validation failed." })
  message!: string;

  @ApiProperty({
    required: false,
    type: [String],
    description: "Presente solo sui 400 di validazione: un messaggio per campo rifiutato.",
    example: ["email must be an email"],
  })
  details?: string[];
}

// ──────────────────────────────── Auth ────────────────────────────────

export class HealthResponse {
  @ApiProperty({ type: String, example: "ok" })
  status!: string;
}

export class UserProfileResponse implements UserProfileDto {
  @ApiProperty({ type: String, example: "665f1b2c9d4e5a0012ab34cd" })
  id!: string;

  @ApiProperty({ type: String, example: "Marco" })
  firstName!: string;

  @ApiProperty({ type: String, example: "Barbiero" })
  lastName!: string;

  @ApiProperty({ type: String, format: "email", example: "marco@example.com" })
  email!: string;

  @ApiProperty({
    enum: ["DEVELOPER", "SECURITY_AUDITOR", "PROJECT_MANAGER"],
    description: "Scelto alla registrazione e non piu' modificabile.",
  })
  role!: UserRole;
}

export class AuthTokenResponse implements AuthTokenDto {
  @ApiProperty({
    type: String,
    description: "JWT HS256, valido 8 ore. Da presentare come `Authorization: Bearer <token>`.",
  })
  accessToken!: string;
}

// ───────────────────────────── Credenziali ─────────────────────────────

export class ServiceCredentialResponse implements ServiceCredentialDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({
    type: String,
    example: "GITHUB",
    description: "Il solo provider supportato oggi.",
  })
  provider!: string;

  @ApiProperty({
    type: String,
    format: "date-time",
    description: "Istante dell'ultima validazione riuscita.",
  })
  connectedAt!: string;
}

export class CredentialsStatusResponse {
  @ApiProperty({ enum: ["UNKNOWN", "MISSING", "CONNECTED", "INVALID"] })
  status!: CredentialsStatus;
}

// ───────────────────────────── Operazioni ─────────────────────────────

export class OperationDescriptorResponse implements OperationDescriptorDto {
  @ApiProperty({
    enum: [
      "DOCS_README",
      "DOCS_INLINE",
      "DOCS_API",
      "SECURITY_OWASP",
      "SECURITY_POLICY",
      "CHANGELOG_TECHNICAL",
      "CHANGELOG_BUSINESS",
    ],
  })
  code!: OperationCode;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String })
  description!: string;

  @ApiProperty({ enum: ["DOCS", "SECURITY", "CHANGELOG"] })
  agent!: "DOCS" | "SECURITY" | "CHANGELOG";
}

// ───────────────────────────── Repository ─────────────────────────────

export class RepositorySummaryResponse implements RepositorySummary {
  @ApiProperty({ type: String, example: "SkynetUniGroup" })
  owner!: string;

  @ApiProperty({ type: String, example: "Code_Guardian" })
  name!: string;

  @ApiProperty({ type: Boolean })
  isPrivate!: boolean;

  @ApiProperty({ type: String, example: "develop" })
  defaultBranch!: string;

  @ApiProperty({ nullable: true, type: String, example: "TypeScript" })
  primaryLanguage!: string | null;
}

export class RefEntryResponse implements RefEntry {
  @ApiProperty({ type: String, example: "develop" })
  name!: string;

  @ApiProperty({ type: String, example: "0cb050b1f3a2c4d5e6f7a8b9c0d1e2f3a4b5c6d7" })
  sha!: string;
}

export class RefSummaryResponse implements RefSummary {
  @ApiProperty({ type: [RefEntryResponse] })
  branches!: RefEntryResponse[];

  @ApiProperty({ type: [RefEntryResponse] })
  tags!: RefEntryResponse[];
}

export class TreeNodeResponse implements TreeNode {
  @ApiProperty({ type: String, example: "src/main.ts" })
  path!: string;

  @ApiProperty({ enum: ["file", "dir"] })
  type!: "file" | "dir";

  @ApiProperty({ type: Number, description: "0 per le directory." })
  sizeBytes!: number;
}

export class RepositoryTreeResponse {
  @ApiProperty({ type: [TreeNodeResponse] })
  entries!: TreeNodeResponse[];

  @ApiProperty({ type: [String], example: ["typescript", "python"] })
  detectedLanguages!: string[];
}

// ─────────────────────────────── Contesti ───────────────────────────────

export class AnalysisContextResponse implements AnalysisContextDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  repoOwner!: string;

  @ApiProperty({ type: String })
  repoName!: string;

  @ApiProperty({ type: Boolean })
  isPrivate!: boolean;

  @ApiProperty({ type: String })
  branch!: string;

  @ApiProperty({ type: String, description: "SHA a cui l'analisi e' ancorata (RF.17)." })
  resolvedSha!: string;

  @ApiProperty({ enum: ["FULL_REPOSITORY", "FILES", "DIRECTORIES"] })
  scopeType!: ScopeType;

  @ApiProperty({
    type: [String],
    description:
      "Solo i linguaggi che gli agenti sanno analizzare, ordinati per numero di file decrescente.",
    example: ["typescript", "python"],
  })
  detectedLanguages!: string[];

  @ApiProperty({
    type: [String],
    description:
      "RF.24 — i linguaggi presenti che gli agenti non sanno analizzare, stesso ordinamento.",
    example: ["go", "shell"],
  })
  unsupportedLanguages!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Il linguaggio con piu' file, supportato o meno; null se non c'e' codice.",
  })
  predominantLanguage!: string | null;

  @ApiProperty({
    type: Boolean,
    description:
      "RF.24 — avviso non bloccante: vero quando il linguaggio predominante non e' fra quelli supportati.",
  })
  unsupportedLanguageWarning!: boolean;

  @ApiProperty({ type: Number })
  estimatedFileCount!: number;

  @ApiProperty({
    type: Boolean,
    description: "RV.8 — avviso non bloccante su un README non in inglese.",
  })
  nonEnglishReadmeDetected!: boolean;
}

// ──────────────────────────────── Task ────────────────────────────────

export class TaskErrorResponse implements TaskError {
  @ApiProperty({ type: String, example: "LLM_RATE_LIMITED" })
  code!: string;

  @ApiProperty({ type: String })
  message!: string;

  @ApiProperty({ type: String, description: "La fase dell'esecuzione in cui l'errore e' emerso." })
  stage!: string;
}

export class PendingInputResponse {
  @ApiProperty({ enum: ["SPRINT_ID", "INCOMPLETE_TASKS", "BUSINESS_CONFIRMATION"] })
  kind!: "SPRINT_ID" | "INCOMPLETE_TASKS" | "BUSINESS_CONFIRMATION";

  @ApiProperty({
    required: false,
    type: [String],
    description: "Solo per INCOMPLETE_TASKS: le issue senza metadati sufficienti.",
  })
  taskIds?: string[];

  @ApiProperty({
    type: String,
    required: false,
    description: "Solo per BUSINESS_CONFIRMATION: il report tecnico da rivedere.",
  })
  technicalReportId?: string;
}

// `pendingInput` e `remediation` sono unioni discriminate: appiattirle in una
// classe sola e' l'unico modo di darle a Swagger, ma vuol dire che TypeScript
// non puo' piu' verificarle contro l'interfaccia. Si escludono percio' dal
// vincolo `implements`, che resta a coprire tutti gli altri campi — meglio la
// verifica su nove campi su dieci che nessuna verifica del tutto.
export class TaskResponse implements Omit<TaskDto, "pendingInput"> {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  batchId!: string | null;

  @ApiProperty({
    enum: [
      "DOCS_README",
      "DOCS_INLINE",
      "DOCS_API",
      "SECURITY_OWASP",
      "SECURITY_POLICY",
      "CHANGELOG_TECHNICAL",
      "CHANGELOG_BUSINESS",
    ],
  })
  operation!: OperationCode;

  @ApiProperty({ enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] })
  status!: TaskStatus;

  @ApiProperty({ type: Number, minimum: 0, maximum: 100 })
  progressPercent!: number;

  @ApiProperty({ type: String, nullable: true })
  currentStage!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Valorizzato quando il Task raggiunge uno stato terminale con un Report.",
  })
  reportId!: string | null;

  @ApiProperty({ type: TaskErrorResponse, nullable: true })
  error!: TaskErrorResponse | null;

  @ApiProperty({
    type: PendingInputResponse,
    nullable: true,
    description: "L'input che il Task sta aspettando; null se non ne aspetta.",
  })
  pendingInput!: PendingInputResponse | null;
}

export class CreateTaskBatchResponse implements CreateTaskBatchResult {
  @ApiProperty({ type: [String], description: "Un id per operazione richiesta." })
  taskIds!: string[];

  @ApiProperty({ type: String })
  batchId!: string;
}

// ─────────────────────────────── Report ───────────────────────────────

export class RemediationResponse {
  @ApiProperty({ enum: ["SNIPPET", "TEXT"] })
  kind!: "SNIPPET" | "TEXT";

  @ApiProperty({ type: String, required: false, description: "Solo per SNIPPET." })
  language?: string;

  @ApiProperty({ type: String, required: false, description: "Solo per SNIPPET." })
  code?: string;

  @ApiProperty({ type: String, required: false, description: "Solo per TEXT." })
  text?: string;
}

export class TextBlockResponse implements TextBlock {
  @ApiProperty({ enum: ["TEXT"] })
  kind!: "TEXT";

  @ApiProperty({ type: Number, required: false })
  order?: number;

  @ApiProperty({ type: String })
  markdown!: string;
}

export class FindingBlockResponse implements Omit<FindingBlock, "remediation"> {
  @ApiProperty({ enum: ["FINDING"] })
  kind!: "FINDING";

  @ApiProperty({ type: Number, required: false })
  order?: number;

  @ApiProperty({ type: String })
  category!: string;

  @ApiProperty({ enum: ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] })
  severity!: Severity;

  @ApiProperty({ type: String })
  filePath!: string;

  @ApiProperty({ type: Number })
  lineStart!: number;

  @ApiProperty({ type: Number, required: false })
  lineEnd?: number;

  @ApiProperty({ type: String })
  description!: string;

  @ApiProperty({ type: RemediationResponse })
  remediation!: RemediationResponse;
}

export class PolicyViolationBlockResponse implements Omit<PolicyViolationBlock, "remediation"> {
  @ApiProperty({ enum: ["POLICY_VIOLATION"] })
  kind!: "POLICY_VIOLATION";

  @ApiProperty({ type: Number, required: false })
  order?: number;

  @ApiProperty({ type: String })
  ruleId!: string;

  @ApiProperty({ type: String })
  ruleText!: string;

  @ApiProperty({ type: String })
  filePath!: string;

  @ApiProperty({ type: String })
  explanation!: string;

  @ApiProperty({ enum: ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] })
  severity!: Severity;

  @ApiProperty({ type: RemediationResponse })
  remediation!: RemediationResponse;
}

export class ComplexityWarningBlockResponse implements ComplexityWarningBlock {
  @ApiProperty({ enum: ["COMPLEXITY_WARNING"] })
  kind!: "COMPLEXITY_WARNING";

  @ApiProperty({ type: Number, required: false })
  order?: number;

  @ApiProperty({ enum: ["INFO"] })
  severity!: "INFO";

  @ApiProperty({ type: String })
  filePath!: string;

  @ApiProperty({ type: Number })
  lineStart!: number;

  @ApiProperty({ type: Number })
  lineEnd!: number;

  @ApiProperty({ type: String })
  explanation!: string;
}

export class ChangelogItemBlockResponse implements ChangelogItemBlock {
  @ApiProperty({ enum: ["CHANGELOG_ITEM"] })
  kind!: "CHANGELOG_ITEM";

  @ApiProperty({ type: Number, required: false })
  order?: number;

  @ApiProperty({ type: String, example: "#396" })
  issueRef!: string;

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({ type: String })
  detail!: string;
}

export class SastFindingBlockResponse implements SastFindingBlock {
  @ApiProperty({ enum: ["SAST_FINDING"] })
  kind!: "SAST_FINDING";

  @ApiProperty({ type: Number, required: false })
  order?: number;

  @ApiProperty({ type: String, description: "Identificativo della regola Semgrep." })
  ruleId!: string;

  @ApiProperty({ type: String, description: '"OWASP-UNKNOWN" quando la regola non lo dichiara.' })
  owaspCategory!: string;

  @ApiProperty({ type: String, required: false })
  cwe?: string;

  @ApiProperty({
    enum: ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"],
    description: "Derivata da ruleSeverity: ERROR→HIGH, WARNING→MEDIUM, INFO→INFO.",
  })
  severity!: Severity;

  @ApiProperty({ enum: ["ERROR", "WARNING", "INFO"] })
  ruleSeverity!: SastRuleSeverity;

  @ApiProperty({ type: String })
  filePath!: string;

  @ApiProperty({ type: Number })
  lineStart!: number;

  @ApiProperty({ type: String })
  message!: string;

  @ApiProperty({ type: String, required: false })
  codeSnippet?: string;

  @ApiProperty({
    enum: ["CONFIRMED", "FALSE_POSITIVE", "NEEDS_REVIEW"],
    description: "Il giudizio dell'LLM sul finding sollevato da Semgrep.",
  })
  verdict!: SastVerdict;

  @ApiProperty({ type: String, required: false })
  llmRemediation?: string;
}

export class SastSummaryBlockResponse implements SastSummaryBlock {
  @ApiProperty({ enum: ["SAST_SUMMARY"] })
  kind!: "SAST_SUMMARY";

  @ApiProperty({ type: Number, required: false })
  order?: number;

  @ApiProperty({ type: Number })
  totalFindings!: number;

  @ApiProperty({ type: Number })
  confirmedFindings!: number;

  @ApiProperty({ type: Number })
  falsePositives!: number;

  @ApiProperty({ type: Number })
  needsReview!: number;

  @ApiProperty({
    type: Number,
    description: "Finding esclusi dal tetto di quelli sottoposti all'LLM.",
  })
  cappedFindings!: number;

  @ApiProperty({ type: Number })
  scannedFiles!: number;

  @ApiProperty({ type: Number })
  durationMs!: number;

  @ApiProperty({
    type: Boolean,
    description: "True se Semgrep ha superato il timeout: risultati parziali.",
  })
  timedOut!: boolean;
}

export class ReportContextResponse implements ReportContext {
  @ApiProperty({ type: String })
  repoOwner!: string;

  @ApiProperty({ type: String })
  repoName!: string;

  @ApiProperty({ type: String })
  repoUrl!: string;

  @ApiProperty({ type: String })
  branch!: string;

  @ApiProperty({ type: String })
  resolvedSha!: string;

  @ApiProperty({ enum: ["FULL_REPOSITORY", "FILES", "DIRECTORIES"] })
  scopeType!: ScopeType;

  @ApiProperty({ type: [String] })
  paths!: string[];
}

export class ProposalPublishErrorResponse implements ProposalPublishError {
  @ApiProperty({ type: String, example: "PR_CREATION_FAILED" })
  kind!: string;

  @ApiProperty({ type: String })
  message!: string;
}

export class ProposalResponse implements Proposal {
  @ApiProperty({ type: String })
  targetPath!: string;

  @ApiProperty({ type: String, description: "Diff unificato, applicabile a mano." })
  diffUnified!: string;

  @ApiProperty({ type: String })
  language!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Valorizzato quando il backend e' riuscito ad aprire la Pull Request.",
  })
  pullRequestUrl!: string | null;

  @ApiProperty({
    type: ProposalPublishErrorResponse,
    required: false,
    nullable: true,
    description:
      "RF.72 — valorizzato quando l'apertura della Pull Request e' fallita. Il diff resta comunque qui sopra.",
  })
  pullRequestError?: ProposalPublishErrorResponse | null;
}

export class ReportErrorResponse implements ReportError {
  @ApiProperty({ type: String, example: "TIMEOUT" })
  kind!: string;

  @ApiProperty({ type: String })
  message!: string;

  @ApiProperty({ type: String })
  stage!: string;
}

export class ReportSummaryResponse implements ReportSummaryDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({
    enum: [
      "DOCS_README",
      "DOCS_INLINE",
      "DOCS_API",
      "SECURITY_OWASP",
      "SECURITY_POLICY",
      "CHANGELOG_TECHNICAL",
      "CHANGELOG_BUSINESS",
    ],
  })
  operation!: OperationCode;

  @ApiProperty({ enum: ["COMPLETED", "FAILED"] })
  status!: ReportStatus;

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({ type: String, format: "date-time" })
  generatedAt!: string;
}

// `body` e' un'unione discriminata su `kind`: si dichiara con oneOf, non con
// un `type` singolo, altrimenti il documento prometterebbe un solo tipo di
// blocco su un array che ne contiene sette.
@ApiExtraModels(
  TextBlockResponse,
  FindingBlockResponse,
  PolicyViolationBlockResponse,
  ComplexityWarningBlockResponse,
  ChangelogItemBlockResponse,
  SastFindingBlockResponse,
  SastSummaryBlockResponse,
)
export class ReportResponse implements Omit<ReportDto, "body" | "proposal" | "pendingAction"> {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  taskId!: string;

  @ApiProperty({
    enum: [
      "DOCS_README",
      "DOCS_INLINE",
      "DOCS_API",
      "SECURITY_OWASP",
      "SECURITY_POLICY",
      "CHANGELOG_TECHNICAL",
      "CHANGELOG_BUSINESS",
    ],
  })
  operation!: OperationCode;

  @ApiProperty({ enum: ["COMPLETED", "FAILED"] })
  status!: ReportStatus;

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  summary!: string | null;

  @ApiProperty({ type: String, format: "date-time" })
  generatedAt!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "Tempo macchina accumulato dagli invii all'agente: non comprende l'attesa in coda ne' quella di un input umano.",
  })
  durationMs!: number | null;

  @ApiProperty({ type: Number })
  tokensConsumed!: number;

  @ApiProperty({ type: ReportContextResponse })
  context!: ReportContextResponse;

  @ApiProperty({
    description: "Il corpo del report: un'unione discriminata su `kind`.",
    type: "array",
    items: {
      oneOf: [
        { $ref: getSchemaPath(TextBlockResponse) },
        { $ref: getSchemaPath(FindingBlockResponse) },
        { $ref: getSchemaPath(PolicyViolationBlockResponse) },
        { $ref: getSchemaPath(ComplexityWarningBlockResponse) },
        { $ref: getSchemaPath(ChangelogItemBlockResponse) },
        { $ref: getSchemaPath(SastFindingBlockResponse) },
        { $ref: getSchemaPath(SastSummaryBlockResponse) },
      ],
      discriminator: { propertyName: "kind" },
    },
  })
  body!: unknown[];

  @ApiProperty({
    type: ProposalResponse,
    required: false,
    description: "Presente solo sui report degli agenti Docs.",
  })
  proposal?: ProposalResponse;

  @ApiProperty({
    type: PendingInputResponse,
    nullable: true,
    description: "Proiezione read-only del pendingInput del Task proprietario.",
  })
  pendingAction!: PendingInputResponse | null;

  @ApiProperty({ type: ReportErrorResponse, required: false })
  error?: ReportErrorResponse;
}
