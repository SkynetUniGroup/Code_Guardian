// Any failure that doesn't map to one of these values must fall back to
// UPSTREAM. A GitHub network/reachability failure must also map to UPSTREAM, never CREDENTIAL_INVALID
// GitHub returns the same 404 for "repo doesn't exist" and "repo exists but this token can't
// see it", so a dropped connection would otherwise look identical to a bad credential.
export type ErrorKind =
  | 'TIMEOUT'
  | 'PARSING'
  | 'UPSTREAM'
  | 'CONTEXT_TOO_LARGE'
  | 'CONTEXT_RESOURCE_MISSING'
  | 'CONTEXT_RESOURCE_INVALID'
  | 'PR_CREATION_FAILED'
  | 'USAGE_LIMIT_EXCEEDED'
  | 'CREDENTIAL_INVALID'
  | 'LLM_RATE_LIMITED'
  | 'READABILITY_TOO_LOW';
