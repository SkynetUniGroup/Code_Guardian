import { mapAgentErrorKind } from './agent-error-mapping';

describe('mapAgentErrorKind', () => {
  it('passes through identical names', () => {
    expect(mapAgentErrorKind('TIMEOUT')).toBe('TIMEOUT');
    expect(mapAgentErrorKind('CONTEXT_TOO_LARGE')).toBe('CONTEXT_TOO_LARGE');
  });

  it('renames RATE_LIMITED to LLM_RATE_LIMITED', () => {
    expect(mapAgentErrorKind('RATE_LIMITED')).toBe('LLM_RATE_LIMITED');
  });

  it('falls back to UPSTREAM for unknown or missing values', () => {
    expect(mapAgentErrorKind('SOMETHING_NEW')).toBe('UPSTREAM');
    expect(mapAgentErrorKind(undefined)).toBe('UPSTREAM');
  });
});
