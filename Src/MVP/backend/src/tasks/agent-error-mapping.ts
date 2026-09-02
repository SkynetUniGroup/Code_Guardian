import { ErrorKind } from '../common/exceptions/error-kind';

// Python-side ErrorKind names -> backend ErrorKind. Mostly identical;
// RATE_LIMITED is the one rename. Unknown values fall back to UPSTREAM.
const MAP: Record<string, ErrorKind> = {
  TIMEOUT: 'TIMEOUT',
  PARSING: 'PARSING',
  UPSTREAM: 'UPSTREAM',
  CONTEXT_TOO_LARGE: 'CONTEXT_TOO_LARGE',
  CONTEXT_RESOURCE_MISSING: 'CONTEXT_RESOURCE_MISSING',
  CONTEXT_RESOURCE_INVALID: 'CONTEXT_RESOURCE_INVALID',
  READABILITY_TOO_LOW: 'READABILITY_TOO_LOW',
  RATE_LIMITED: 'LLM_RATE_LIMITED',
};

export function mapAgentErrorKind(value: string | undefined): ErrorKind {
  return (value && MAP[value]) || 'UPSTREAM';
}
