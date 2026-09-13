import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TextBlock } from "../../types";

interface TextBlockRendererProps {
  block: TextBlock;
}

/**
 * Renders a TextBlock as formatted Markdown.
 *
 * Used for changelog entries and general-purpose summary text produced by the
 * Changelog agent. The markdown string may contain headers, lists, and inline
 * code spans. We use a simple lightweight renderer to avoid a heavy dependency;
 * if richer formatting is needed in the future, replace with react-markdown.
 *
 * Current implementation: renders the raw markdown in a <pre> with whitespace
 * preservation. Replace with a proper Markdown renderer when react-markdown is
 * installed via `pnpm add react-markdown`.
 */
export function TextBlockRenderer({ block }: TextBlockRendererProps) {
  return (
    <div className="rounded border border-[#cccccc] bg-white p-4">
      <div
        className="prose prose-sm max-w-none text-[#2a2a2a]
          prose-headings:text-[#2a2a2a] prose-headings:font-semibold
          prose-a:text-[#2277cc] prose-strong:text-[#2a2a2a]
          prose-code:text-[#2a2a2a] prose-code:before:content-none prose-code:after:content-none
          prose-li:my-0.5"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.markdown}</ReactMarkdown>
      </div>
    </div>
  );
}
