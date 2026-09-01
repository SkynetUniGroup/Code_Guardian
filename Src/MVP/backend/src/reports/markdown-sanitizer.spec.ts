import { sanitizeMarkdown, sanitizeReportBody } from './markdown-sanitizer';
import { Block } from './report.types';

describe('sanitizeMarkdown', () => {
  it('leaves plain Markdown untouched', () => {
    expect(sanitizeMarkdown('# Title\n\nSome **bold** text.')).toBe(
      '# Title\n\nSome **bold** text.',
    );
  });

  it('strips raw HTML tags', () => {
    expect(sanitizeMarkdown('before <script>alert(1)</script> after')).toBe(
      'before alert(1) after',
    );
  });

  it('strips a self-closing or attribute-bearing tag', () => {
    expect(sanitizeMarkdown('<img src="x" onerror="alert(1)">text')).toBe(
      'text',
    );
  });

  it('rejects a javascript: link destination but keeps the link text', () => {
    expect(sanitizeMarkdown('[click me](javascript:alert(1))')).toBe(
      'click me',
    );
  });

  it('rejects a data: link destination, case-insensitively', () => {
    expect(sanitizeMarkdown('[img](DATA:text/html;base64,PHNjcmlwdD4=)')).toBe(
      'img',
    );
  });

  it('leaves an ordinary https link untouched', () => {
    expect(sanitizeMarkdown('[docs](https://example.com)')).toBe(
      '[docs](https://example.com)',
    );
  });
});

describe('sanitizeReportBody', () => {
  it('sanitizes markdown on a TextBlock', () => {
    const body: Block[] = [
      { kind: 'TEXT', markdown: '<b>hi</b> [x](javascript:1)' },
    ];

    expect(sanitizeReportBody(body)).toEqual([
      { kind: 'TEXT', markdown: 'hi x' },
    ]);
  });

  it('sanitizes explanation and remediation on a FindingBlock, leaves structured fields alone', () => {
    const body: Block[] = [
      {
        kind: 'FINDING',
        category: 'A03:2021',
        severity: 'high',
        filePath: 'src/x.ts',
        startLine: 1,
        endLine: 2,
        explanation: '<script>bad()</script>',
        remediationKind: 'TEXT',
        remediation: '[fix](javascript:void(0))',
      },
    ];

    expect(sanitizeReportBody(body)).toEqual([
      {
        kind: 'FINDING',
        category: 'A03:2021',
        severity: 'high',
        filePath: 'src/x.ts',
        startLine: 1,
        endLine: 2,
        explanation: 'bad()',
        remediationKind: 'TEXT',
        remediation: 'fix',
      },
    ]);
  });

  it('sanitizes explanation and remediation on a PolicyViolationBlock', () => {
    const body: Block[] = [
      {
        kind: 'POLICY_VIOLATION',
        ruleId: 'RULE-1',
        ruleText: 'no console.log',
        filePath: 'src/x.ts',
        explanation: '<i>bad</i>',
        severity: 'low',
        remediation: 'remove it',
      },
    ];

    expect(
      (sanitizeReportBody(body)[0] as { explanation: string }).explanation,
    ).toBe('bad');
  });

  it('sanitizes explanation on a ComplexityWarningBlock', () => {
    const body: Block[] = [
      {
        kind: 'COMPLEXITY_WARNING',
        filePath: 'src/x.ts',
        startLine: 1,
        endLine: 40,
        explanation: '<b>too long</b>',
        severity: 'info',
      },
    ];

    expect(
      (sanitizeReportBody(body)[0] as { explanation: string }).explanation,
    ).toBe('too long');
  });

  it('sanitizes detail on a ChangelogItemBlock', () => {
    const body: Block[] = [
      {
        kind: 'CHANGELOG_ITEM',
        issueRef: 'ISS-1',
        title: 'Added X',
        detail: '<b>details</b>',
      },
    ];

    expect((sanitizeReportBody(body)[0] as { detail: string }).detail).toBe(
      'details',
    );
  });

  it('does not mutate the original blocks', () => {
    const original: Block[] = [{ kind: 'TEXT', markdown: '<b>hi</b>' }];

    sanitizeReportBody(original);

    expect(original[0]).toEqual({ kind: 'TEXT', markdown: '<b>hi</b>' });
  });
});
