import type { SastSummaryBlock } from "../../types";

interface SastSummaryRendererProps {
  block: SastSummaryBlock;
}

/**
 * Riepilogo della fase di analisi statica.
 *
 * Sta in cima al report perché risponde alla prima domanda che ci si pone
 * davanti a una lista di finding: quanti ne ha trovati lo strumento, quanti ne
 * ha confermati il modello, e — soprattutto — se sto guardando un risultato
 * completo. Un timeout di Semgrep o un tetto raggiunto rendono la lista
 * parziale, e senza dirlo qui l'assenza di finding sembrerebbe un esito
 * positivo invece che un'analisi interrotta.
 */
export function SastSummaryRenderer({ block }: SastSummaryRendererProps) {
  const stats: Array<{ label: string; value: number; className: string }> = [
    { label: "Confermati", value: block.confirmedFindings, className: "text-[#cc2222]" },
    { label: "Falsi positivi", value: block.falsePositives, className: "text-[#2a8a2a]" },
    { label: "Da rivedere", value: block.needsReview, className: "text-gray-500" },
  ];

  const is_partial = block.timedOut || block.cappedFindings > 0;

  return (
    <div className="rounded border border-[#cccccc] bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Semgrep
        </span>
        <span className="text-sm font-semibold text-[#2a2a2a]">Analisi statica</span>
        <span className="text-xs text-gray-400">
          {block.scannedFiles} file · {(block.durationMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="flex flex-wrap gap-6">
        <div>
          <span className="block text-2xl font-semibold text-[#2a2a2a]">{block.totalFindings}</span>
          <span className="text-xs text-gray-400">Finding totali</span>
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
              Semgrep ha superato il tempo massimo ed è stato interrotto prima di restituire i
              risultati: l'assenza di finding qui sotto non significa che non ce ne siano.
            </p>
          )}
          {block.cappedFindings > 0 && (
            <p className={block.timedOut ? "mt-1" : undefined}>
              {block.cappedFindings} finding non sono stati sottoposti al modello per via del limite
              configurato: restano conteggiati nel totale ma senza verdetto.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
