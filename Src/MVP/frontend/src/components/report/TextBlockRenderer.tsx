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
 * code spans. React Markdown, with GitHub Flavored Markdown support, keeps this
 * presentation consistent wherever a text report block is shown.
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
