// Any failure that doesn't map to one of these codes must fall back to
// INTERNAL_ERROR. A GitHub network/reachability failure must also map to
// INTERNAL_ERROR, never CREDENTIAL_INVALID — GitHub returns the same 404 for
// "repo doesn't exist" and "repo exists but this token can't see it", so a
// dropped connection would otherwise look identical to a bad credential.
export type ErrorCode =
  | 'USAGE_LIMIT_EXCEEDED'
  | 'LLM_TIMEOUT'
  | 'LLM_RATE_LIMITED'
  | 'OUTPUT_UNPARSABLE'
  | 'CONTEXT_TOO_LARGE'
  | 'CONTEXT_RESOURCE_MISSING'
  | 'CONTEXT_RESOURCE_INVALID'
  | 'READABILITY_TOO_LOW'
  | 'PR_CREATION_FAILED'
  | 'CREDENTIAL_INVALID'
  | 'INTERNAL_ERROR';
