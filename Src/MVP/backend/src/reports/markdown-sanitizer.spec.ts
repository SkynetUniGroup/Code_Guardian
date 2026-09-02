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

// markdown-sanitizer.adversarial.spec.ts states the requirement with one
// payload per family. These are the same families spelled differently — the
// question a fix has to survive is not "does the recorded payload fail?" but
// "does anything in this class still get through?". A fix that recognised
// `&#106;` and not `&#X6A;` would pass that file and still be open.
describe('sanitizeMarkdown — other spellings of a hidden scheme', () => {
  const rejected = [
    // Uppercase hex marker and uppercase digits: normalization lowercases
    // before anything else looks at the string.
    ['uppercase hex reference', '[x](&#X6A;avascript:alert(1))'],
    // Leading zeros are legal in a numeric reference and change nothing
    // about what it decodes to.
    ['zero-padded decimal reference', '[x](&#0000106;avascript:alert(1))'],
    ['zero-padded hex reference', '[x](&#x0006a;avascript:alert(1))'],
    // Not the first character of the scheme — any position works, because
    // the parser decodes the whole destination, not a prefix of it.
    ['reference in the middle of the scheme', '[x](java&#115;cript:alert(1))'],
    ['reference at the end of the scheme', '[x](javascrip&#116;:alert(1))'],
    // Named references that are not &colon;. A denylist of "the dangerous
    // entities" would need every one of these; the rule needs none.
    ['&Tab; inside the scheme keyword', '[x](java&Tab;script:alert(1))'],
    [
      '&NewLine; inside the scheme keyword',
      '[x](java&NewLine;script:alert(1))',
    ],
    // data:, hidden by its delimiter rather than by its keyword.
    ['data: with a named colon', '[x](data&colon;text/html,PHN2Zz4=)'],
    // The image form goes down the same path, leading `!` included.
    ['an image destination', '![x](&#106;avascript:alert(1))'],
    // vbscript: is not named in BE-18 at all — it is rejected because it is
    // not in the allowlist, and hiding it changes nothing about that.
    ['a scheme outside the allowlist', '[x](vb&#115;cript:msgbox(1))'],
  ] as const;

  it.each(rejected)('rejects %s', (_name, payload) => {
    const output = sanitizeMarkdown(payload);

    expect(output).toBe('x');
  });

  // The rule is "a character reference makes a destination unsafe unless an
  // allowed scheme is already complete in the clear before it". These are
  // the cases on the other side of that line: they must keep working, or the
  // fix has traded a security hole for a content-destroying one.
  it('keeps an http(s) destination whose query string contains a reference', () => {
    expect(sanitizeMarkdown('[q](https://example.com/s?a=1&amp;b=2)')).toBe(
      '[q](https://example.com/s?a=1&amp;b=2)',
    );
  });

  it('keeps a bare ampersand, which is not a character reference at all', () => {
    // No semicolon, so nothing decodes; the vast majority of real query
    // strings look like this.
    expect(sanitizeMarkdown('[q](https://example.com/s?a=1&b=2)')).toBe(
      '[q](https://example.com/s?a=1&b=2)',
    );
  });

  it('keeps a mailto: destination carrying a reference in its parameters', () => {
    expect(
      sanitizeMarkdown('[m](mailto:dev@example.com?subject=A&amp;B)'),
    ).toBe('[m](mailto:dev@example.com?subject=A&amp;B)');
  });

  it('keeps a relative destination with an unterminated ampersand sequence', () => {
    // `&#106` without the closing `;` is not a character reference, so
    // CommonMark leaves it alone and so does this.
    expect(sanitizeMarkdown('[r](./a&#106b.ts)')).toBe('[r](./a&#106b.ts)');
  });
});
