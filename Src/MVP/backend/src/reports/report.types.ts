import type { ErrorKind } from "../common/exceptions/error-kind";

export type {
  Block,
  ChangelogItemBlock,
  ComplexityWarningBlock,
  FindingBlock,
  PolicyViolationBlock,
  Proposal,
  ProposalPublishError,
  Remediation,
  ReportContext,
  ReportError,
  ReportStatus,
  Severity,
  TextBlock,
} from "@codeguardian/shared";

//export type ReportStatus = 'COMPLETED' | 'FAILED';

//export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

// Equivalente su Report di TaskError, con il nome di campo diverso per scelta
// (`kind` qui, `code` su Task) — stesso dominio di valori, due nomi mantenuti
// come nel PoC (§11.2). Dichiarato per esteso e non come `extends ReportError`:
// estenderlo avrebbe portato dentro anche il vecchio campo `code`, che
// assembleFailed non ha mai valorizzato — un campo obbligatorio secondo il tipo
// e `undefined` in ogni documento realmente scritto.
export interface ReportErrorB {
  kind: ErrorKind;
  message: string;
  stage: string;
}

/*export interface Proposal {
  targetPath: string;
  diffUnified: string;
  language: string;
  pullRequestUrl: string | null;
}

export interface TextBlock {
  kind: 'TEXT';
  markdown: string;
}

export interface FindingBlock {
  kind: 'FINDING';
  category: string;
  severity: Severity;
  filePath: string;
  startLine: number;
  endLine: number;
  explanation: string;
  remediationKind: 'SNIPPET' | 'TEXT';
  remediationLanguage?: string;
  remediation: string;
}

// remediation stays a plain string here, unlike FindingBlock — confirmed
// unchanged from the PoC's original diagram (Figure 4), Table 8 only adds
// `severity` to this block, nothing about remediation's shape.
export interface PolicyViolationBlock {
  kind: 'POLICY_VIOLATION';
  ruleId: string;
  ruleText: string;
  filePath: string;
  explanation: string;
  severity: Severity;
  remediation: string;
}

export interface ComplexityWarningBlock {
  kind: 'COMPLEXITY_WARNING';
  filePath: string;
  startLine: number;
  endLine: number;
  explanation: string;
  severity: 'info';
}

export interface ChangelogItemBlock {
  kind: 'CHANGELOG_ITEM';
  issueRef: string;
  title: string;
  detail: string;
}

export type Block =
  | TextBlock
  | FindingBlock
  | PolicyViolationBlock
  | ComplexityWarningBlock
  | ChangelogItemBlock;

export interface ReportContext {
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  branch: string;
  resolvedSha: string;
  scopeType: 'FULL_REPOSITORY' | 'FILES' | 'DIRECTORIES';
  paths: string[];
}*/
