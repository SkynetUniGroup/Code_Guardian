import type { TextBlock } from '../../types';

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
      <pre className="whitespace-pre-wrap font-sans text-sm text-[#2a2a2a] leading-relaxed">
        {block.markdown}
      </pre>
    </div>
  );
}
