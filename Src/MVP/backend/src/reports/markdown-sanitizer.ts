import { Block } from './report.types';

// Raw HTML embedded in Markdown that's meant to be rendered as Markdown, not
// as HTML — any tag, opening or closing. Deliberately broad (not just
// <script>/<iframe>): the point isn't to allow a "safe" subset of HTML
// through, it's that this content was never supposed to contain HTML at all.
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;

// Schemes a link destination is allowed to keep. An allowlist, not a
// javascript:/data: denylist: BE-18 words the requirement as "reject
// javascript:/data:" and this satisfies it, but a denylist only ever knows
// about the bypasses someone already thought of. The first version of this
// file spelled those two schemes out literally and was defeated twice —
// once by a destination nesting parentheses deeper than its regex
// tolerated, once by `java<TAB>script:`, which every browser reads as
// `javascript:` anyway. Nothing outside these three is something an
// analysis report has a legitimate reason to link to, so anything else
// keeps its text and loses its destination. (If the team would rather have
// the literal denylist, invert this set — but then every new bypass is
// another patch here.)
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto']);

// RFC 3986: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":". No
// match means the destination is relative (`./src/x.ts`, `#anchor`) —
// nothing a browser can execute, so nothing to reject.
const SCHEME = /^([a-z][a-z0-9+.-]*):/;

// BE-18: the one place Markdown coming out of an agent gets cleaned, so that
// screen rendering and PDF export (BE-20) always consume the same
// already-sanitized string instead of each having to defend against this
// separately.
export function sanitizeMarkdown(markdown: string): string {
  return rejectUnsafeLinks(markdown.replace(HTML_TAG, ''));
}

// Walks the text looking for `[label](destination)` and its `![alt](...)`
// image form, keeping each one only if its destination survives
// isSafeDestination(). A scanner rather than one more regex on purpose: a
// destination can nest parentheses arbitrarily deep — `alert(String
// .fromCharCode(88))` is two levels of perfectly ordinary function calls —
// and a regex that tries to balance them either tolerates a fixed depth,
// silently letting anything deeper through unchecked, or stops at the first
// `)` and leaves half the link behind. Counting depth is the only version
// of this that doesn't have a "one level deeper" bypass already waiting in
// it.
function rejectUnsafeLinks(markdown: string): string {
  let out = '';
  let index = 0;

  while (index < markdown.length) {
    const open = markdown.indexOf('[', index);
    if (open === -1) {
      out += markdown.slice(index);
      break;
    }

    out += markdown.slice(index, open);
    const link = readLink(markdown, open);

    if (!link) {
      // Not a link after all — no `](` following the label, or parentheses
      // that never close. The `[` is just a character.
      out += '[';
      index = open + 1;
      continue;
    }

    if (isSafeDestination(link.destination)) {
      out += markdown.slice(open, link.end + 1);
    } else {
      // The text the agent wrote is kept; only the destination is dropped.
      // Deleting the whole link would silently lose content, which is worse
      // than showing it without making it clickable. An image's leading `!`
      // goes with it, or it would be left dangling in front of the alt text.
      if (out.endsWith('!')) {
        out = out.slice(0, -1);
      }
      out += link.label;
    }
    index = link.end + 1;
  }

  return out;
}

interface ParsedLink {
  label: string;
  destination: string;
  /** Index of the destination's closing parenthesis. */
  end: number;
}

function readLink(markdown: string, open: number): ParsedLink | null {
  const labelEnd = markdown.indexOf(']', open + 1);
  if (labelEnd === -1 || markdown[labelEnd + 1] !== '(') {
    return null;
  }

  let depth = 1;
  let cursor = labelEnd + 2;
  let destination = '';

  while (cursor < markdown.length) {
    const char = markdown[cursor];

    if (char === '\\' && cursor + 1 < markdown.length) {
      // An escaped character can neither open nor close the destination.
      destination += char + markdown[cursor + 1];
      cursor += 2;
      continue;
    }

    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          label: markdown.slice(open + 1, labelEnd),
          destination,
          end: cursor,
        };
      }
    }

    destination += char;
    cursor += 1;
  }

  return null;
}

// Judges the *normalized* destination — the way a browser would read it,
// not the way it happens to be spelled. ASCII control characters are
// removed (the WHATWG URL parser strips tab/newline/CR before it looks at
// the scheme, which is exactly why `java<TAB>script:` executes), the rest
// is trimmed and lowercased. Normalizing can only make this check stricter:
// it never turns a destination that would have been rejected into an
// accepted one.
//
// The whole destination is examined, Markdown title syntax and all
// (`[x](url "title")`). A compliant parser would cut the title off at the
// first space — but this filter exists for the renderer that doesn't, and
// looking at more than strictly necessary costs nothing here.
function isSafeDestination(destination: string): boolean {
  const normalized = destination
    // eslint-disable-next-line no-control-regex -- the point is the control characters
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .toLowerCase();

  const scheme = SCHEME.exec(normalized);
  return scheme === null || ALLOWED_SCHEMES.has(scheme[1]);
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
