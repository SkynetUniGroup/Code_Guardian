import React from 'react';
import type { ReportBlock, TextBlock, FindingBlock, PolicyViolationBlock, ChangelogItemBlock } from '../types';

interface ReportRendererProps {
  blocks: ReportBlock[];
}

const TextBlockRenderer: React.FC<{ block: TextBlock }> = ({ block }) => (
  <div className="prose max-w-none">
    {/* Nel PoC usiamo un tag <pre> per preservare la formattazione testuale. 
        In un'implementazione avanzata, potresti usare librerie come react-markdown. */}
    <pre className="whitespace-pre-wrap font-sans text-[#2a2a2a] bg-gray-50 p-4 rounded-lg border border-gray-100">
      {block.markdown}
    </pre>
  </div>
);

const FindingBlockRenderer: React.FC<{ block: FindingBlock }> = ({ block }) => {
  const severityStyles: Record<string, string> = {
    info: 'bg-blue-100 text-blue-800 border-blue-200',
    low: 'bg-green-100 text-green-800 border-green-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    high: 'bg-orange-100 text-orange-800 border-orange-200',
    critical: 'bg-red-100 text-red-800 border-red-200',
  };

  const badgeClass = severityStyles[block.severity] || 'bg-gray-100 text-[#2a2a2a] border-gray-200';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[#2a2a2a] text-lg">{block.owaspCategory}</h3>
        <span className={`px-2.5 py-0.5 text-xs font-bold uppercase rounded-full border ${badgeClass}`}>
          {block.severity}
        </span>
      </div>
      
      <div className="text-sm font-mono text-gray-500 bg-gray-50 p-2.5 rounded border border-gray-100">
        <strong>File:</strong> {block.filePath} <span className="text-gray-400">|</span> <strong>Righe:</strong> {block.startLine} - {block.endLine}
      </div>
      
      <p className="text-[#2a2a2a] leading-relaxed">{block.explanation}</p>
      
      <div className="mt-2 bg-gray-900 text-gray-100 p-3.5 rounded-md text-sm overflow-x-auto shadow-inner">
        <strong className="text-gray-400 block mb-1.5 uppercase text-xs tracking-wider">Rimedio proposto:</strong>
        <pre><code>{block.remediation}</code></pre>
      </div>
    </div>
  );
};

const PolicyViolationBlockRenderer: React.FC<{ block: PolicyViolationBlock }> = ({ block }) => (
  <div className="flex flex-col gap-2">
    <h3 className="font-semibold text-red-700 text-lg">Violazione: {block.ruleId}</h3>
    <div className="text-sm text-gray-500 bg-gray-50 p-2 rounded border border-gray-100">
      <strong>File:</strong> <code>{block.filePath}</code>
    </div>
    <p className="text-[#2a2a2a] mt-1"><strong>Regola violata:</strong> {block.ruleText}</p>
    <p className="text-[#2a2a2a]">{block.explanation}</p>
    
    <div className="mt-3 text-sm text-[#2a2a2a] bg-yellow-50 p-3 border border-yellow-200 rounded shadow-sm">
      <strong className="block mb-1 text-yellow-800">Azione richiesta:</strong> 
      {block.remediation}
    </div>
  </div>
);

const ChangelogItemBlockRenderer: React.FC<{ block: ChangelogItemBlock }> = ({ block }) => (
  <div className="flex flex-col gap-1.5 pb-3 border-b border-gray-100 last:border-0 last:pb-0">
    <div className="flex items-start gap-2.5">
      <span className="font-mono text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
        {block.issueRef}
      </span>
      <span className="font-medium text-[#2a2a2a]">{block.title}</span>
    </div>
    <p className="text-sm text-gray-500 pl-2.5 border-l-2 border-gray-200 ml-5">
      {block.detail}
    </p>
  </div>
);

export default function ReportRenderer({ blocks }: ReportRendererProps) {
  // Ordiniamo i blocchi rispettando fedelmente il campo "order" del contratto backend
  const sortedBlocks = [...blocks].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-5">
      {sortedBlocks.map((block, index) => {
        // La combinazione di kind e index previene key colisions
        const key = `${block.kind}-${index}`;

        return (
          <div key={key} className="p-5 border border-gray-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow duration-200">
            {block.kind === 'text' && <TextBlockRenderer block={block} />}
            {block.kind === 'finding' && <FindingBlockRenderer block={block} />}
            {block.kind === 'policy_violation' && <PolicyViolationBlockRenderer block={block} />}
            {block.kind === 'changelog_item' && <ChangelogItemBlockRenderer block={block} />}
          </div>
        );
      })}
    </div>
  );
}