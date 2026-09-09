import type { ComplexityWarningBlock } from "../../types";

interface ComplexityWarningRendererProps {
  block: ComplexityWarningBlock;
}

/**
 * Renderer del blocco COMPLEXITY_WARNING, prodotto dall'agente Docs quando
 * incontra una funzione troppo complessa per essere documentata in modo utile.
 *
 * Esisteva nel contratto (shared/types.ts, models.py) ma non aveva un renderer:
 * il dispatcher di ReportDetailPage cadeva nel `default` e restituiva null, così
 * questi blocchi venivano scritti nel report, esportati nel PDF e non mostrati
 * mai a schermo.
 *
 * Severità fissa a INFO — non è un difetto, è un avviso — quindi niente
 * SeverityBadge: il tono neutro lo distingue da finding e violazioni.
 */
export function ComplexityWarningRenderer({ block }: ComplexityWarningRendererProps) {
  return (
    <div className="rounded border border-[#cccccc] bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Complessità elevata
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
