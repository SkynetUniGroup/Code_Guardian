import { GITHUB_REPO_URL_REGEX, parseGithubUrl } from './github-url';

describe('GITHUB_REPO_URL_REGEX / parseGithubUrl', () => {
  it('accepts a well-formed GitHub repository URL', () => {
    expect(GITHUB_REPO_URL_REGEX.test('https://github.com/owner/repo')).toBe(
      true,
    );
    expect(parseGithubUrl('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('accepts owner/repo names with dots, hyphens, and underscores', () => {
    expect(parseGithubUrl('https://github.com/my-org/repo.name_2')).toEqual({
      owner: 'my-org',
      repo: 'repo.name_2',
    });
  });

  it.each([
    'http://github.com/owner/repo', // wrong scheme
    'https://gitlab.com/owner/repo', // wrong host
    'https://github.com/owner', // missing repo segment
    'https://github.com/owner/repo/extra', // extra segment
    'https://github.com/owner/repo/', // trailing slash
    'not a url at all',
  ])('rejects %s', (url) => {
    expect(GITHUB_REPO_URL_REGEX.test(url)).toBe(false);
  });

  it('throws when asked to parse something the regex would reject', () => {
    expect(() => parseGithubUrl('not a url')).toThrow();
  });
});
