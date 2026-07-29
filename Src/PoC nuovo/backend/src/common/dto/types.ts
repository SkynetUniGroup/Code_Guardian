// Tipi fondamentali 

export type ScopeType = 'FULL_REPOSITORY' | 'FILES' | 'DIRECTORIES';

export type OperationCode = 
  | 'DOCS_README' 
  | 'DOCS_INLINE' 
  | 'DOCS_API' 
  | 'SECURITY_OWASP' 
  | 'SECURITY_POLICY' 
  | 'CHANGELOG_TECHNICAL' 
  | 'CHANGELOG_BUSINESS';

export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ReportStatus = 'COMPLETED' | 'FAILED';