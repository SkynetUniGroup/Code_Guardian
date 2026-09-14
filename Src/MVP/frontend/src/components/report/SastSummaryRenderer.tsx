import type { SastSummaryBlock } from "../../types";

interface SastSummaryRendererProps {
  block: SastSummaryBlock;
}

/**
 * Summary of the static analysis phase.
 *
 * It sits at the top of the report because it answers the first question one
 * asks when faced with a list of findings: how many did the tool find, how many
 * did the model confirm, and — above all — whether you are looking at a
 * complete result. A Semgrep timeout or a reached cap make the list partial,
 * and without saying so here the absence of findings would look like a
 * positive outcome rather than an interrupted analysis.
 */
export function SastSummaryRenderer({ block }: SastSummaryRendererProps) {
  const stats: Array<{ label: string; value: number; className: string }> = [
    { label: "Confirmed", value: block.confirmedFindings, className: "text-[#cc2222]" },
    { label: "False positives", value: block.falsePositives, className: "text-[#2a8a2a]" },
    { label: "Needs review", value: block.needsReview, className: "text-gray-500" },
  ];

  const is_partial = block.timedOut || block.cappedFindings > 0;

  return (
    <div className="rounded border border-[#cccccc] bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Semgrep
        </span>
        <span className="text-sm font-semibold text-[#2a2a2a]">Static analysis</span>
        <span className="text-xs text-gray-400">
          {block.scannedFiles} files · {(block.durationMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="flex flex-wrap gap-6">
        <div>
          <span className="block text-2xl font-semibold text-[#2a2a2a]">{block.totalFindings}</span>
          <span className="text-xs text-gray-400">Total findings</span>
        </div>
        {stats.map(({ label, value, className }) => (
          <div key={label}>
            <span className={`block text-2xl font-semibold ${className}`}>{value}</span>
            <span className="text-xs text-gray-400">{label}</span>
          </div>
        ))}
      </div>

      {is_partial && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-[#8a5a00]">
          {block.timedOut && (
            <p>
              Semgrep exceeded the maximum time and was interrupted before returning results: the
              absence of findings below does not mean there are none.
            </p>
          )}
          {block.cappedFindings > 0 && (
            <p className={block.timedOut ? "mt-1" : undefined}>
              {block.cappedFindings} findings were not submitted to the model due to the configured
              limit: they remain counted in the total but without a verdict.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
