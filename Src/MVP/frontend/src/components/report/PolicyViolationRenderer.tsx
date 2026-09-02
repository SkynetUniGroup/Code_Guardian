import { useState } from 'react';
import type { PolicyViolationBlock } from '../../types';

interface PolicyViolationRendererProps {
  block: PolicyViolationBlock;
}

/**
 * Renders a policy-violation block from a SECURITY_POLICY scan.
 *
 * Each violation references a rule from the repository's POLICY.md file and
 * points to the file/location where the rule is violated. The explanation and
 * remediation are collapsible to keep the list compact.
 */
export function PolicyViolationRenderer({ block }: PolicyViolationRendererProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border border-[#e05800]/40 bg-white overflow-hidden">
      {/* Header row */}
      <button
        className="flex w-full items-start gap-3 p-4 text-left hover:bg-orange-50/50 transition"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Rule ID pill */}
        <span className="inline-flex shrink-0 items-center rounded bg-[#e05800]/10 px-2 py-0.5 text-xs font-semibold text-[#e05800] mt-0.5">
          {block.ruleId}
        </span>

        <div className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-[#2a2a2a] truncate">
            {block.ruleText}
          </span>
          <span className="block text-xs text-gray-500 truncate">{block.filePath}</span>
        </div>

        {/* Chevron */}
        <svg
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Detail panel */}
      {expanded && (
        <div className="border-t border-[#e05800]/20 divide-y divide-[#eeeeee] px-4 py-3 bg-orange-50/30">
          <div className="pb-3">
            <span className="text-xs font-semibold uppercase text-gray-500">Spiegazione</span>
            <p className="mt-1 text-sm text-[#2a2a2a] leading-relaxed">{block.explanation}</p>
          </div>
          <div className="pt-3">
            <span className="text-xs font-semibold uppercase text-gray-500">Rimedio</span>
            <p className="mt-1 text-sm text-[#2a2a2a] leading-relaxed">{block.remediation}</p>
          </div>
        </div>
      )}
    </div>
  );
}
