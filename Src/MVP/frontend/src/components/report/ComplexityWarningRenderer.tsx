import type { ComplexityWarningBlock } from "../../types";

interface ComplexityWarningRendererProps {
  block: ComplexityWarningBlock;
}

/**
 * Renderer for the COMPLEXITY_WARNING block, produced by the Docs agent when
 * it encounters a function too complex to be documented usefully.
 *
 * It existed in the contract (shared/types.ts, models.py) but had no renderer:
 * the dispatcher in ReportDetailPage fell into the `default` case and
 * returned null, so these blocks were written to the report, exported to the
 * PDF, and never shown on screen.
 *
 * Fixed severity at INFO — it is not a defect, it is a notice — so no
 * SeverityBadge: the neutral tone distinguishes it from findings and
 * violations.
 */
export function ComplexityWarningRenderer({ block }: ComplexityWarningRendererProps) {
  return (
    <div className="rounded border border-[#cccccc] bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
          High complexity
        </span>
        <span className="truncate font-mono text-xs text-gray-500">
          {block.filePath}
          {block.lineStart === block.lineEnd
            ? `:${block.lineStart}`
            : `:${block.lineStart}–${block.lineEnd}`}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-[#2a2a2a]">{block.explanation}</p>
    </div>
  );
}
