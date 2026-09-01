import { Block } from './report.types';

// Raw HTML embedded in Markdown that's meant to be rendered as Markdown, not
// as HTML — any tag, opening or closing. Deliberately broad (not just
// <script>/<iframe>): the point isn't to allow a "safe" subset of HTML
// through, it's that this content was never supposed to contain HTML at all.
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;

// A Markdown link/image whose destination uses a javascript: or data: scheme
// — the two schemes a browser will actually execute or render as content
// rather than navigate to. Case-insensitive scheme, since `JavaScript:` etc.
// works exactly the same as a browser exploit. The destination itself is
// matched with one level of paren-nesting allowed (`(?:[^()]|\([^()]*\))*`)
// rather than a naive `[^)]*` — a bare `[^)]*` stops at the *first* `)`,
// which a payload like `javascript:alert(1)` has one of before the link's
// own closing paren, leaving that closing paren behind as literal, unmatched
// text and the rest of the destination unrejected.
const DANGEROUS_LINK =
  /\[([^\]]*)\]\(\s*(?:javascript|data):(?:[^()]|\([^()]*\))*\)/gi;

// BE-18: the one place Markdown coming out of an agent gets cleaned, so that
// screen rendering and PDF export (BE-20) always consume the same
// already-sanitized string instead of each having to defend against this
// separately. Link text is kept (as plain text) when its destination is
// rejected — dropping the whole link would silently delete content the
// agent wrote, which is worse than just not making it clickable.
export function sanitizeMarkdown(markdown: string): string {
  return markdown.replace(HTML_TAG, '').replace(DANGEROUS_LINK, '$1');
}

// Applies sanitizeMarkdown to every Markdown-bearing field across the Block
// union, by kind — structured fields (filePath, ruleId, severity, line
// numbers...) are never free-form text an agent could inject through, so
// they're left untouched. Proposal.diffUnified is a unified diff, not
// Markdown, and is intentionally out of scope here.
export function sanitizeReportBody(body: Block[]): Block[] {
  return body.map(sanitizeBlock);
}

function sanitizeBlock(block: Block): Block {
  switch (block.kind) {
    case 'TEXT':
      return { ...block, markdown: sanitizeMarkdown(block.markdown) };
    case 'FINDING':
      return {
        ...block,
        explanation: sanitizeMarkdown(block.explanation),
        remediation: sanitizeMarkdown(block.remediation),
      };
    case 'POLICY_VIOLATION':
      return {
        ...block,
        explanation: sanitizeMarkdown(block.explanation),
        remediation: sanitizeMarkdown(block.remediation),
      };
    case 'COMPLEXITY_WARNING':
      return { ...block, explanation: sanitizeMarkdown(block.explanation) };
    case 'CHANGELOG_ITEM':
      return { ...block, detail: sanitizeMarkdown(block.detail) };
  }
}
