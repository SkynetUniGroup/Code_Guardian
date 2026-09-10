import { normalizePaths } from './path-normalization';

describe('normalizePaths', () => {
  it('strips a leading slash', () => {
    expect(normalizePaths(['/src/index.ts'])).toEqual(['src/index.ts']);
  });

  it('drops "." and ".." segments wherever they appear', () => {
    expect(normalizePaths(['src/./index.ts', 'a/../b/c'])).toEqual([
      'src/index.ts',
      'a/b/c',
    ]);
  });

  it('collapses duplicate slashes via empty-segment filtering', () => {
    expect(normalizePaths(['src//index.ts'])).toEqual(['src/index.ts']);
  });

  it('deduplicates paths that normalize to the same value', () => {
    expect(normalizePaths(['/src/index.ts', 'src/index.ts'])).toEqual([
      'src/index.ts',
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalizePaths([])).toEqual([]);
  });
});
