import type { ReportBlock } from '../types';

interface ReportRendererProps {
  blocks: ReportBlock[];
}

const BlockComponents: Record<string, React.ComponentType<{ content: string; metadata?: Record<string, unknown> }>> = {
  markdown: ({ content }) => (
    <div className="prose max-w-none">
      <div dangerouslySetInnerHTML={{ __html: content }} />
    </div>
  ),
  code: ({ content, metadata }) => (
    <pre className="bg-gray-800 text-white p-4 rounded-lg overflow-x-auto">
      <code>{content}</code>
      {metadata?.language && (
        <span className="text-xs text-gray-400 mt-1 block">
          {metadata.language}
        </span>
      )}
    </pre>
  ),
  text: ({ content }) => <p>{content}</p>,
  list: ({ content }) => (
    <ul className="list-disc pl-5">
      {content.split('\n').map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  ),
  default: ({ content }) => <div>{content}</div>,
};

export default function ReportRenderer({ blocks }: ReportRendererProps) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        const BlockComponent = BlockComponents[block.type] || BlockComponents.default;
        return (
          <div key={index} className="p-4 border border-gray-200 rounded-lg">
            <BlockComponent content={block.content} metadata={block.metadata} />
          </div>
        );
      })}
    </div>
  );
}