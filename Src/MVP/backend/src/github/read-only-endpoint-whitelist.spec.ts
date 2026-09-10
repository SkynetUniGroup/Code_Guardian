import {
  READ_ONLY_ENDPOINT_WHITELIST,
  isReadOnlyEndpointAllowed,
} from './read-only-endpoint-whitelist';

describe('isReadOnlyEndpointAllowed', () => {
  it('allows every route actually in the whitelist', () => {
    for (const route of READ_ONLY_ENDPOINT_WHITELIST) {
      expect(isReadOnlyEndpointAllowed(route)).toBe(true);
    }
  });

  it('rejects a write route', () => {
    expect(isReadOnlyEndpointAllowed('POST /repos/{owner}/{repo}/pulls')).toBe(
      false,
    );
  });

  it('rejects backend-direct routes that are not part of the facade', () => {
    expect(
      isReadOnlyEndpointAllowed('GET /repos/{owner}/{repo}/compare/{basehead}'),
    ).toBe(false);
    expect(isReadOnlyEndpointAllowed('GET /user')).toBe(false);
    expect(isReadOnlyEndpointAllowed('GET /user/repos')).toBe(false);
    expect(isReadOnlyEndpointAllowed('GET /repos/{owner}/{repo}')).toBe(false);
  });
});
