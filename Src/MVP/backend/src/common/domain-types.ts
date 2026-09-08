export type OperationCode =
  | 'DOCS_README'
  | 'DOCS_INLINE'
  | 'DOCS_API'
  | 'SECURITY_OWASP'
  | 'SECURITY_POLICY'
  | 'CHANGELOG_TECHNICAL'
  | 'CHANGELOG_BUSINESS';

// Mirrors USER_ROLES (auth/schemas/user.schema.ts): the one place the seven
// values are listed as data, not just as a type — used by
// CreateTaskBatchDto's validation so the allowed set can't drift from the
// type without a compile error.
export const OPERATION_CODES: OperationCode[] = [
  'DOCS_README',
  'DOCS_INLINE',
  'DOCS_API',
  'SECURITY_OWASP',
  'SECURITY_POLICY',
  'CHANGELOG_TECHNICAL',
  'CHANGELOG_BUSINESS',
];

export type ScopeType = 'FULL_REPOSITORY' | 'FILES' | 'DIRECTORIES';
