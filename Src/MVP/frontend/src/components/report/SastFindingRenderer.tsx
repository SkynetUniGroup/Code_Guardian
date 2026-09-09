import { useState } from "react";
import type { SastFindingBlock, SastVerdict } from "../../types";
import { SeverityBadge } from "../shared/SeverityBadge";

interface SastFindingRendererProps {
  block: SastFindingBlock;
}

/**
 * Come si legge il verdetto dell'LLM su un finding di Semgrep.
 *
 * NEEDS_REVIEW non è un errore né un successo: è il caso in cui il modello non
 * si è pronunciato — o perché il finding è stato escluso dal tetto, o perché
 * l'LLM non l'ha citato nella sua risposta. Merita un colore neutro e una
 * dicitura che non suggerisca né "risolto" né "vulnerabile".
 */
const VERDICT_STYLE: Record<SastVerdict, { label: string; className: string }> = {
  CONFIRMED: {
    label: "Confermato",
    className: "bg-[#cc2222]/10 text-[#cc2222]",
  },
  FALSE_POSITIVE: {
    label: "Falso positivo",
    className: "bg-[#2a8a2a]/10 text-[#2a8a2a]",
  },
  NEEDS_REVIEW: {
    label: "Da rivedere",
    className: "bg-gray-100 text-gray-500",
  },
};

/**
 * Renderer di un finding prodotto dall'analisi statica (Semgrep) e poi
 * giudicato dall'LLM.
 *
 * Distinto da FindingBlockRenderer di proposito: qui la provenienza è una
 * regola deterministica, non il modello, e sono proprio la regola, la categoria
 * OWASP, il CWE e il verdetto a dire a un revisore quanto fidarsi del
 * risultato. Un finding marcato falso positivo resta visibile — nasconderlo
 * significherebbe chiedere all'utente di fidarsi del giudizio dell'LLM senza
 * potergli dare un'occhiata.
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
            <span className="text-xs font-semibold uppercase text-gray-500">Regola</span>
            <p className="mt-1 break-all font-mono text-xs text-gray-500">
              {block.ruleId} <span className="text-gray-400">({block.ruleSeverity})</span>
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[#2a2a2a]">{block.message}</p>
          </div>

          {block.codeSnippet && (
            <div className="py-3">
              <span className="text-xs font-semibold uppercase text-gray-500">Codice</span>
              <pre className="mt-1 overflow-x-auto rounded bg-white p-2 font-mono text-xs leading-relaxed text-[#2a2a2a]">
                {block.codeSnippet}
              </pre>
            </div>
          )}

          {block.llmRemediation && (
            <div className="pt-3">
              <span className="text-xs font-semibold uppercase text-gray-500">
                Rimedio suggerito
              </span>
              <p className="mt-1 text-sm leading-relaxed text-[#2a2a2a]">{block.llmRemediation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
