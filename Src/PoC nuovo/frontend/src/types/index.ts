export type OperationCode = 'docs-inline' | 'security-scan' | 'changelog-tech';

export type ReportStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface ReportBlock {
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface Report {
  _id: string;
  taskId: string;
  agentId: string;
  operation: OperationCode;
  status: ReportStatus;
  durationMs?: number;
  tokensConsumed?: number;
  summary?: string;
  error?: { kind: string; message: string; stage: string };
  body: ReportBlock[];
  proposal?: unknown;
  generatedAt: string;
}

export interface Task {
  id: string;
  contextId: string;
  operation: OperationCode;
  status: ReportStatus;
  reportId?: string;
}