import { AgentRegistry } from './agent-registry.service';
import { OperationCode } from '../common/domain-types';

function codesOf(descriptors: { code: OperationCode }[]): OperationCode[] {
  return descriptors.map((d) => d.code).sort();
}

describe('AgentRegistry', () => {
  const registry = new AgentRegistry();

  it('gives DEVELOPER exactly the Docs operations plus the shared changelog one', () => {
    expect(codesOf(registry.getForRole('DEVELOPER'))).toEqual(
      ['CHANGELOG_TECHNICAL', 'DOCS_API', 'DOCS_INLINE', 'DOCS_README'].sort(),
    );
  });

  it('gives SECURITY_AUDITOR exactly the two Security operations', () => {
    expect(codesOf(registry.getForRole('SECURITY_AUDITOR'))).toEqual(
      ['SECURITY_OWASP', 'SECURITY_POLICY'].sort(),
    );
  });

  it('gives PROJECT_MANAGER both changelog operations and nothing else', () => {
    expect(codesOf(registry.getForRole('PROJECT_MANAGER'))).toEqual(
      ['CHANGELOG_BUSINESS', 'CHANGELOG_TECHNICAL'].sort(),
    );
  });

  it('never leaks allowedRoles into the returned descriptors', () => {
    const [first] = registry.getForRole('DEVELOPER');
    expect(first).not.toHaveProperty('allowedRoles');
    expect(Object.keys(first).sort()).toEqual(
      ['agent', 'code', 'description', 'displayName'].sort(),
    );
  });

  it('returns the configured timeout for a known operation', () => {
    expect(registry.getTimeoutS('DOCS_INLINE')).toBe(90);
  });

  it('throws for an unknown operation code', () => {
    expect(() => registry.getTimeoutS('NOT_REAL' as never)).toThrow(
      'Unknown OperationCode',
    );
  });

  it('returns the agent that owns a known operation', () => {
    expect(registry.getAgent('CHANGELOG_BUSINESS')).toBe('CHANGELOG');
    expect(registry.getAgent('DOCS_README')).toBe('DOCS');
    expect(registry.getAgent('SECURITY_OWASP')).toBe('SECURITY');
  });

  it('throws for an unknown operation code when looking up the owning agent', () => {
    expect(() => registry.getAgent('NOT_REAL' as never)).toThrow(
      'Unknown OperationCode',
    );
  });
});
