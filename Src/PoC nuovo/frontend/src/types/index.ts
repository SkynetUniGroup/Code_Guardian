export type OperationCode = 
  | 'DOCS_README' | 'DOCS_INLINE' | 'DOCS_API'
  | 'SECURITY_OWASP' | 'SECURITY_POLICY'
  | 'CHANGELOG_TECHNICAL' | 'CHANGELOG_BUSINESS';

export type ReportStatus = 'pending' | 'completed' | 'failed' | 'cancelled';


export interface TextBlock {
  kind: 'text';
  order: number;
  markdown: string;
}

export interface FindingBlock {
  kind: 'finding';
  order: number;
  owaspCategory: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  filePath: string;
  startLine: number;
  endLine: number;
  explanation: string;
  remediation: string;
}

export interface PolicyViolationBlock {
  kind: 'policy_violation';
  order: number;
  ruleId: string;
  ruleText: string;
  filePath: string;
  explanation: string;
  remediation: string;
}

export interface ChangelogItemBlock {
  kind: 'changelog_item';
  order: number;
  issueRef: string;
  title: string;
  detail: string;
}

export type ReportBlock = TextBlock | FindingBlock | PolicyViolationBlock | ChangelogItemBlock;

export interface Proposal {
  targetPath: string;
  diffUnified: string;
  language: string;
}

export interface Report {
  id: string;
  taskId: string;
  agentId: string;
  operation: OperationCode;
  status: ReportStatus;
  durationMs?: number;
  tokensConsumed?: number;
  summary?: string;
  error?: { kind: string; message: string; stage: string };
  body: ReportBlock[];
  proposal?: Proposal;
  generatedAt: string;
}

export interface Task {
  id: string;
  contextId: string;
  operation: OperationCode;
  status: ReportStatus;
  reportId?: string;
}