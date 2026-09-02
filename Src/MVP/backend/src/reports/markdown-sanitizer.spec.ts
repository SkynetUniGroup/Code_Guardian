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

  it('keeps a relative destination, which has no scheme to execute', () => {
    expect(sanitizeMarkdown('[src](./src/auth/login.ts)')).toBe(
      '[src](./src/auth/login.ts)',
    );
    expect(sanitizeMarkdown('[jump](#findings)')).toBe('[jump](#findings)');
  });

  it('keeps a mailto: destination', () => {
    expect(sanitizeMarkdown('[write](mailto:dev@example.com)')).toBe(
      '[write](mailto:dev@example.com)',
    );
  });

  it('keeps an https destination that carries a Markdown title', () => {
    expect(sanitizeMarkdown('[docs](https://example.com "The title")')).toBe(
      '[docs](https://example.com "The title")',
    );
  });

  it('rejects a scheme that is neither javascript: nor data: but still cannot be navigated to safely', () => {
    // The filter is an allowlist, so this needs no dedicated rule: vbscript:
    // is rejected for the same reason ftp: or file: would be — it simply
    // isn't one of the three schemes a report has a reason to link to.
    expect(sanitizeMarkdown('[legacy](vbscript:msgbox(1))')).toBe('legacy');
    expect(sanitizeMarkdown('[local](file:///etc/passwd)')).toBe('local');
  });

  it('drops the leading ! as well when an image destination is rejected', () => {
    // Otherwise the `!` of `![alt](...)` is left dangling in front of the
    // alt text it no longer applies to.
    expect(
      sanitizeMarkdown('![chart](data:image/svg+xml,<svg/onload=1>)'),
    ).toBe('chart');
  });

  it('leaves an unclosed destination alone instead of eating the rest of the text', () => {
    expect(
      sanitizeMarkdown('[oops](https://example.com and then more text'),
    ).toBe('[oops](https://example.com and then more text');
  });

  it('leaves reference-style links and array indexes alone', () => {
    expect(sanitizeMarkdown('see [docs][1] and arr[0] below')).toBe(
      'see [docs][1] and arr[0] below',
    );
  });

  // BE-18's requirement is "rifiutare destinazioni javascript:/data:" — a
  // security property, not "match this specific regex shape". The two tests
  // below encode that property directly (destination rejected, link text
  // kept) rather than any particular implementation's mechanics. Both were
  // written against the original regex, which they defeated; they are kept
  // verbatim as the regression guard for the scanner that replaced it.
  describe('adversarial payloads', () => {
    it('rejects a javascript: destination with two levels of nested parens', () => {
      // Two levels of paren nesting is nothing exotic — it is one
      // perfectly ordinary function call inside another. The original regex
      // balanced exactly one level, so a second made it fail to match at
      // all and the whole link, javascript: scheme included, passed through
      // untouched. The scanner counts depth instead, so no nesting depth is
      // special.
      const output = sanitizeMarkdown(
        '[click](javascript:alert(String.fromCharCode(88)))',
      );

      expect(output).toBe('click');
      expect(output).not.toMatch(/javascript:/i);
    });

    it('rejects a javascript: destination split by a control character within the scheme keyword', () => {
      // Browsers strip ASCII tab/newline/CR from a URL before parsing its
      // scheme (WHATWG URL, "remove all ASCII tab or newline"), so
      // `java<TAB>script:alert(1)` and `javascript:alert(1)` are the same
      // URL to every browser — a well-known javascript: filter bypass. A
      // literal `javascript|data` alternation never matches it; deciding on
      // the destination *after* normalizing it the way the browser does is
      // what closes this, rather than another spelling added to a list.
      const output = sanitizeMarkdown(
        '[click](java\tscript:alert(document.cookie))',
      );

      expect(output).toBe('click');
      expect(output).not.toMatch(/java\tscript:/);
    });
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
