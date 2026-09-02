import { useState } from 'react';
import type { FindingBlock } from '../../types';
import { SeverityBadge } from '../shared/SeverityBadge';

interface FindingBlockRendererProps {
  block: FindingBlock;
}

/**
 * Renders a single OWASP security finding.
 *
 * The card displays:
 *  - Severity badge (coloured by level)
 *  - OWASP category
 *  - File path and line range
 *  - Collapsible explanation + remediation sections
 *
 * The collapsible pattern keeps the findings list scannable while still giving
 * access to full detail on demand.
 */
export function FindingBlockRenderer({ block }: FindingBlockRendererProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border border-[#cccccc] bg-white overflow-hidden">
      {/* Header row — always visible */}
      <button
        className="flex w-full items-start gap-3 p-4 text-left hover:bg-gray-50 transition"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <SeverityBadge severity={block.severity} className="mt-0.5 shrink-0" />

        <div className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-[#2a2a2a]">
            {block.owaspCategory}
          </span>
          <span className="block text-xs text-gray-500 truncate">
            {block.filePath} · righe {block.startLine}–{block.endLine}
          </span>
        </div>

        {/* Expand/collapse chevron */}
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

      {/* Expandable detail section */}
      {expanded && (
        <div className="border-t border-[#cccccc] divide-y divide-[#eeeeee] px-4 py-3 bg-gray-50">
          <div className="pb-3">
            <span className="text-xs font-semibold uppercase text-gray-500">Spiegazione</span>
            <p className="mt-1 text-sm text-[#2a2a2a] leading-relaxed">{block.explanation}</p>
          </div>
          <div className="pt-3">
            <span className="text-xs font-semibold uppercase text-gray-500">Rimedio suggerito</span>
            <p className="mt-1 text-sm text-[#2a2a2a] leading-relaxed">{block.remediation}</p>
          </div>
        </div>
      )}
    </div>
  );
}
