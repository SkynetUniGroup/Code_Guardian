import React from "react";
import { SeverityBadge } from "../components/shared/SeverityBadge";
import type {
  Block,
  TextBlock,
  FindingBlock,
  PolicyViolationBlock,
  ChangelogItemBlock,
} from "../types";

interface ReportRendererProps {
  blocks: Block[];
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
  const badgeClass = "bg-gray-100 text-[#2a2a2a] border-gray-200";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[#2a2a2a] text-lg">{block.category}</h3>
        <SeverityBadge severity={block.severity} />
      </div>

      <div className="text-sm font-mono text-gray-500 bg-gray-50 p-2.5 rounded border border-gray-100">
        <strong>File:</strong> {block.filePath} <span className="text-gray-400">|</span>{" "}
        <strong>Righe:</strong> {block.lineStart} - {block.lineEnd}
      </div>

      <p className="text-[#2a2a2a] leading-relaxed">{block.description}</p>

      <div className="mt-2 bg-gray-900 text-gray-100 p-3.5 rounded-md text-sm overflow-x-auto shadow-inner">
        <strong className="text-gray-400 block mb-1.5 uppercase text-xs tracking-wider">
          Rimedio proposto:
        </strong>
        <pre>
          <code>
            {block.remediation.kind === "SNIPPET" ? block.remediation.code : block.remediation.text}
          </code>
        </pre>
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
    <p className="text-[#2a2a2a] mt-1">
      <strong>Regola violata:</strong> {block.ruleText}
    </p>
    <p className="text-[#2a2a2a]">{block.explanation}</p>
    <SeverityBadge severity={block.severity} />

    <div className="mt-3 text-sm text-[#2a2a2a] bg-yellow-50 p-3 border border-yellow-200 rounded shadow-sm">
      <strong className="block mb-1 text-yellow-800">Azione richiesta:</strong>
      {block.remediation.kind === "SNIPPET" ? block.remediation.code : block.remediation.text}
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
    <p className="text-sm text-gray-500 pl-2.5 border-l-2 border-gray-200 ml-5">{block.detail}</p>
  </div>
);

export default function ReportRenderer({ blocks }: ReportRendererProps) {
  return (
    <div className="space-y-5">
      {blocks.map((block, index) => {
        // La combinazione di kind e index previene key colisions
        const key = `${block.kind}-${index}`;

        switch (block.kind) {
          case "TEXT":
            return <TextBlockRenderer key={key} block={block} />;
          case "FINDING":
            return <FindingBlockRenderer key={key} block={block} />;
          case "POLICY_VIOLATION":
            return <PolicyViolationBlockRenderer key={key} block={block} />;
          case "CHANGELOG_ITEM":
            return <ChangelogItemBlockRenderer key={key} block={block} />;
          case "COMPLEXITY_WARNING":
            return null;
          default:
            return null;
        }
      })}
    </div>
  );
}
