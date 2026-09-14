import { useState } from "react";
import type { SastFindingBlock, SastVerdict } from "../../types";
import { SeverityBadge } from "../shared/SeverityBadge";

interface SastFindingRendererProps {
  block: SastFindingBlock;
}

/**
 * How to read the LLM verdict on a Semgrep finding.
 *
 * NEEDS_REVIEW is neither an error nor a success: it is the case where the
 * model did not pronounce itself — either because the finding was excluded
 * by the cap, or because the LLM did not mention it in its response. It
 * deserves a neutral colour and a label that suggests neither "resolved" nor
 * "vulnerable".
 */
const VERDICT_STYLE: Record<SastVerdict, { label: string; className: string }> = {
  CONFIRMED: {
    label: "Confirmed",
    className: "bg-[#cc2222]/10 text-[#cc2222]",
  },
  FALSE_POSITIVE: {
    label: "False positive",
    className: "bg-[#2a8a2a]/10 text-[#2a8a2a]",
  },
  NEEDS_REVIEW: {
    label: "Needs review",
    className: "bg-gray-100 text-gray-500",
  },
};

/**
 * Renderer for a finding produced by static analysis (Semgrep) and then
 * judged by the LLM.
 *
 * Deliberately distinct from FindingBlockRenderer: here the source is a
 * deterministic rule, not the model, and it is precisely the rule, the OWASP
 * category, the CWE, and the verdict that tell a reviewer how much to trust
 * the result. A finding marked as false positive remains visible — hiding it
 * would mean asking the user to trust the LLM's judgement without being able
 * to look at it.
 */
export function SastFindingRenderer({ block }: SastFindingRendererProps) {
  const [expanded, setExpanded] = useState(false);
  const verdict = VERDICT_STYLE[block.verdict];
  const is_dismissed = block.verdict === "FALSE_POSITIVE";

  return (
    <div
      className={[
        "overflow-hidden rounded border bg-white",
        is_dismissed ? "border-[#cccccc] opacity-70" : "border-[#cccccc]",
      ].join(" ")}
    >
      <button
        type="button"
        className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-gray-50"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <SeverityBadge severity={block.severity} className="mt-0.5 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${verdict.className}`}
            >
              {verdict.label}
            </span>
            <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Semgrep
            </span>
            <span className="text-sm font-semibold text-[#2a2a2a]">{block.owaspCategory}</span>
            {block.cwe && <span className="font-mono text-xs text-gray-400">{block.cwe}</span>}
          </div>
          <span className="block truncate font-mono text-xs text-gray-500">
            {block.filePath}:{block.lineStart}
          </span>
        </div>

        <svg
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="divide-y divide-[#eeeeee] border-t border-[#cccccc] bg-gray-50 px-4 py-3">
          <div className="pb-3">
            <span className="text-xs font-semibold uppercase text-gray-500">Rule</span>
            <p className="mt-1 break-all font-mono text-xs text-gray-500">
              {block.ruleId} <span className="text-gray-400">({block.ruleSeverity})</span>
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[#2a2a2a]">{block.message}</p>
          </div>

          {block.codeSnippet && (
            <div className="py-3">
              <span className="text-xs font-semibold uppercase text-gray-500">Code</span>
              <pre className="mt-1 overflow-x-auto rounded bg-white p-2 font-mono text-xs leading-relaxed text-[#2a2a2a]">
                {block.codeSnippet}
              </pre>
            </div>
          )}

          {block.llmRemediation && (
            <div className="pt-3">
              <span className="text-xs font-semibold uppercase text-gray-500">
                Suggested remediation
              </span>
              <p className="mt-1 text-sm leading-relaxed text-[#2a2a2a]">{block.llmRemediation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
