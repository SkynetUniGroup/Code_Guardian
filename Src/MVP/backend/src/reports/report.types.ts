import { ErrorKind } from '../common/exceptions/error-kind';

export type ReportStatus = 'COMPLETED' | 'FAILED';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

// Report's equivalent of Task's TaskError, deliberately named differently
// (`kind` here, `code` on Task) — same value domain, two field names kept
// as-is from the PoC (§11.2).
export interface ReportError {
  kind: ErrorKind;
  message: string;
  stage: string;
}

export interface Proposal {
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
}
