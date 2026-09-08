import { useState } from 'react';
import type { Proposal } from '../../types';

interface ProposalRendererProps {
  proposal: Proposal;
}

/**
 * Renders the Proposal section of a Docs agent report.
 *
 * A Proposal contains:
 *  - The target file path
 *  - A unified diff of the proposed code changes
 *  - An optional PR URL (populated after the PR is opened by the agent)
 *
 * The diff is displayed in a collapsible code block. The PR link is the
 * primary call-to-action element when present.
 */
export function ProposalRenderer({ proposal }: ProposalRendererProps) {
  const [diff_visible, setDiffVisible] = useState(false);

  return (
    <div className="rounded border border-[#cccccc] bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 p-4 border-b border-[#cccccc]">
        <div className="flex items-center gap-2 min-w-0">
          {/* File icon */}
          <svg
            className="h-4 w-4 shrink-0 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <span className="text-sm font-medium text-[#2a2a2a] truncate font-mono">
            {proposal.targetPath}
          </span>
        </div>

        {/* PR link — primary action when available */}
        {proposal.prUrl && (
          <a
            href={proposal.prUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 flex items-center gap-1.5 rounded bg-[#2a8a2a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1e6b1e] transition"
          >
            {/* GitHub icon */}
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
            </svg>
            Vedi PR
          </a>
        )}
      </div>

      {/* Toggle diff preview */}
      <button
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-gray-500 hover:bg-gray-50 transition border-b border-[#cccccc]"
        onClick={() => setDiffVisible((v) => !v)}
      >
        <svg
          className={`h-3.5 w-3.5 transition-transform ${diff_visible ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        {diff_visible ? 'Nascondi' : 'Mostra'} diff
      </button>

      {/* Unified diff */}
      {diff_visible && (
        <pre className="overflow-x-auto p-4 text-xs font-mono leading-relaxed text-[#2a2a2a] bg-gray-50 whitespace-pre">
          {proposal.diffUnified}
        </pre>
      )}
    </div>
  );
}
