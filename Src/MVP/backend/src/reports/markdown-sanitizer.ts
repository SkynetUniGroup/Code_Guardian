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

// A character reference, in any of the three forms CommonMark resolves:
// decimal, hexadecimal, and named. Matched by *shape*, not against the HTML5
// entity list — see isSafeDestination for why that distinction is the whole
// point of this constant.
const CHARACTER_REFERENCE =
  /&(#[0-9]{1,8}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i;

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
      // Safe, but not therefore beyond inspection. The region this scanner
      // calls "the destination" runs to the balanced `)`, while a CommonMark
      // destination ends at the first unescaped whitespace — so the region
      // is a superset, the scheme check only ever looks at its *start*, and
      // everything past the first space used to be judged by nothing at all
      // and then re-emitted whole:
      //
      //   [a](x [b](javascript:alert(1)) )
      //     region:  "x [b](javascript:alert(1)) "
      //     scheme at its start: none -> "relative" -> passes
      //     the parser, however: falls back on the inner link -> javascript:
      //
      // So the region goes back through this same scan before being emitted.
      // Nothing declared safe is re-emitted unexamined, and an inner link is
      // sanitized by exactly the rules an outer one is — including rules
      // this function does not know about yet, since it is the same
      // function.
      //
      // Only the destination is re-scanned, never the label: the label ends
      // at the first `]`, so it cannot contain a complete link, and the
      // "first `]` wins" rule already makes the scanner latch onto the inner
      // link of `[![img](javascript:1)](x)` — the dangerous one. That bias
      // is in the safe direction and is deliberately left alone.
      out += markdown.slice(open, link.destinationStart);
      out += rejectUnsafeLinks(link.destination);
      out += ')';
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
  /** Index just past the `](`, where the destination begins. */
  destinationStart: number;
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
          destinationStart: labelEnd + 2,
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
// The whole region the scanner read is examined, Markdown title syntax and
// all (`[x](url "title")`). A compliant parser would cut the title off at
// the first space; this filter deliberately looks at more, so that a
// renderer that doesn't cut it off is covered too.
//
// Looking at more is not free, though, and the comment here used to claim it
// was. This function only judges the *start* of what it is given, so the
// surplus it looks at is surplus it does not actually check. That is why the
// caller re-scans a region it has declared safe instead of copying it
// through — see rejectUnsafeLinks. The two halves belong together: this one
// decides the scheme, that one makes sure nothing else is hiding in the part
// no scheme check will ever reach.
//
// Character references are the second half of "the way a browser would read
// it", and the harder half. CommonMark resolves them *inside* destinations
// — `[foo](/f&ouml;&ouml;)` renders as `href="/foo"` with umlauts — so the
// filter was judging the string as written while the renderer judged it
// decoded. `&#106;avascript:`, `&#x6a;avascript:` and `javascript&colon;`
// all sailed past a scheme regex that found no `:` where it expected one,
// were declared relative, and were re-emitted verbatim for the renderer to
// decode back into an executable href.
//
// Two ways to close that, and this is the second one:
//
//   1. decode fully, then judge the decoded string. Most precise, but the
//      named references are hundreds of entries and there is no decoder
//      here — `entities` exists only as a transitive dependency, and
//      promoting it to a direct one to sanitize a handful of report strings
//      buys precision this file does not need.
//   2. treat a destination containing a character reference as unsafe
//      unless an allowed scheme is already spelled in the clear *before*
//      the first reference.
//
// What rules out the third option — a table of "the dangerous entities" —
// is that it is a denylist, the exact mistake the allowlist above replaced.
// `&colon;` alone shows why: hiding the delimiter is enough, and a
// delimiter has many spellings.
//
// Rule 2 is safe because the scheme is decided by the text before the first
// `:`, and a reference can only ever *add* to what precedes it. If `https:`,
// `http:` or `mailto:` is already complete and in the clear, no later
// reference can change which scheme the browser sees:
// `https://ok.example/&#106;avascript:x` is an https URL with an odd path.
// If it is not complete, there is no way to know what the destination
// decodes to without decoding it, so it does not survive.
//
// What that costs: a relative destination carrying a legitimate reference —
// `/f&ouml;&ouml;` — loses its link and keeps its text. An agent writing an
// analysis report has little reason to produce one, and the trade is
// deliberate: the failure mode is a link that isn't clickable, rather than
// one that executes.
function isSafeDestination(destination: string): boolean {
  const normalized = destination
    // eslint-disable-next-line no-control-regex -- the point is the control characters
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .toLowerCase();

  const reference = CHARACTER_REFERENCE.exec(normalized);
  const clear =
    reference === null ? normalized : normalized.slice(0, reference.index);

  const scheme = SCHEME.exec(clear);
  if (scheme === null) {
    // Relative — nothing a browser can execute — but only if it is still
    // relative once decoded, which is only knowable when there is nothing
    // left to decode.
    return reference === null;
  }
  return ALLOWED_SCHEMES.has(scheme[1]);
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
