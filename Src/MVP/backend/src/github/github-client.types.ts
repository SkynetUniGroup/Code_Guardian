export interface RepositorySummary {
  owner: string;
  name: string;
  isPrivate: boolean;
  defaultBranch: string;
  primaryLanguage: string | null;
}

export type NodeType = 'file' | 'dir';

export interface TreeNode {
  path: string;
  type: NodeType;
  sizeBytes: number;
}

export interface FileContent {
  path: string;
  content: string;
  sha: string;
  language: string;
}

export interface RefEntry {
  name: string;
  sha: string;
}

export interface RefSummary {
  branches: RefEntry[];
  tags: RefEntry[];
}

export interface IssueSummary {
  number: number;
  title: string;
  state: string;
  labels: string[];
  milestone: string | null;
  closedAt: Date | null;
  hasSufficientMetadata: boolean;
}

export interface IssueDetail extends IssueSummary {
  body: string;
}

export type CompareStatus = 'ahead' | 'behind' | 'identical' | 'diverged';

export interface CompareResult {
  status: CompareStatus;
}
