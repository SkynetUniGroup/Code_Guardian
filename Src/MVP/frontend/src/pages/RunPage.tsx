import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { toApiError } from "../api/errors";
import { ErrorState } from "../components/shared/ErrorState";
import { Spinner } from "../components/shared/Spinner";
import { useSelectionStore } from "../stores/selectionStore";
import type { CreateTaskBatchDto, OperationCode, OperationDescriptorDto } from "../types";

/**
 * RunPage — /run
 *
 * Mostra le operazioni disponibili all'utente leggendole da GET /operations:
 * è il backend (AgentRegistry) a filtrarle per ruolo, ed è sempre il backend a
 * rifiutare con 403 un'operazione non consentita. Una tabella ruolo→operazioni
 * replicata qui poteva solo divergere da quella applicata davvero.
 *
 * This page reads the analysis context set by /select from the selectionStore.
 * If no context has been selected, the user is prompted to go back to /select.
 *
 * Flow:
 *  1. Reads contextId and context metadata from selectionStore.
 *  2. User selects one or more operation cards from those allowed by their role.
 *  3. POSTs CreateTaskBatchDto { contextId, operations[] } to /tasks.
 *  4. On success, clears the selection and redirects to /tasks.
 */
export function RunPage() {
  const navigate = useNavigate();
  const { contextId, context, clearContext } = useSelectionStore();

  // Set of selected operations — the batch can contain more than one.
  const [selected_ops, setSelectedOps] = useState<Set<OperationCode>>(new Set());
  const [launching, setLaunching] = useState(false);
  const [launch_error, setLaunchError] = useState("");

  const [available_ops, setAvailableOps] = useState<OperationDescriptorDto[]>([]);
  const [ops_loading, setOpsLoading] = useState(true);
  const [ops_error, setOpsError] = useState("");

  useEffect(() => {
    async function fetch_operations() {
      try {
        const response = await apiClient.get<OperationDescriptorDto[]>("/operations");
        setAvailableOps(response.data);
      } catch {
        setOpsError("Impossibile caricare le operazioni disponibili. Riprova più tardi.");
      } finally {
        setOpsLoading(false);
      }
    }
    fetch_operations();
  }, []);

  /**
   * Toggles a single operation in/out of the selection set.
   */
  function toggle_op(op: OperationCode) {
    setSelectedOps((prev) => {
      const next = new Set(prev);
      if (next.has(op)) {
        next.delete(op);
      } else {
        next.add(op);
      }
      return next;
    });
    setLaunchError("");
  }

  async function handle_launch() {
    if (selected_ops.size === 0 || !contextId) return;

    setLaunching(true);
    setLaunchError("");

    const dto: CreateTaskBatchDto = {
      contextId,
      operations: Array.from(selected_ops),
    };

    try {
      await apiClient.post("/tasks", dto);
      // Ripulisce il contesto salvato: per un nuovo batch l'utente ripassa da
      // /select, cosi' non si riusa per sbaglio un contesto ormai vecchio.
      // (Il commento c'era gia', la chiamata no.)
      clearContext();
      navigate({ to: "/tasks" });
    } catch (err: unknown) {
      const { status, message } = toApiError(err);
      if (status === 429) {
        // USAGE_LIMIT_EXCEEDED (RF.66): il backend risponde 429, non 402.
        setLaunchError(
          message ?? "Hai raggiunto il limite mensile di operazioni; riprova il mese prossimo.",
        );
      } else if (status === 403) {
        setLaunchError("Il tuo ruolo non è abilitato a una delle operazioni selezionate.");
      } else if (status === 404) {
        setLaunchError("Contesto non trovato. Torna a Repository e ricrea il contesto di analisi.");
      } else {
        setLaunchError("Errore durante l'avvio delle operazioni. Riprova.");
      }
    } finally {
      setLaunching(false);
    }
  }

  // ---- Render ----

  // Guard: if no context has been selected, show a prompt to go to /select.
  if (!contextId || !context) {
    return (
      <ErrorState
        message="Nessun contesto configurato. Vai su Repository per selezionare un repository e configurare l'analisi."
        action={
          <button
            type="button"
            onClick={() => navigate({ to: "/select" })}
            className="rounded bg-[#2277cc] px-3 py-1.5 text-sm text-white hover:bg-[#1a5fa8]"
          >
            Vai a Repository
          </button>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-[#2a2a2a]">Avvia Operazioni</h1>
      <p className="mb-6 text-sm text-gray-400">
        Seleziona una o più operazioni da avviare sul contesto corrente.
      </p>

      {/* Context summary — shows which repo and scope is currently active */}
      <div className="mb-6 rounded-lg border border-[#cccccc] bg-gray-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Contesto attivo
        </p>
        <p className="text-sm font-medium text-[#2a2a2a]">
          {context.repoOwner}/{context.repoName}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          SHA: <span className="font-mono">{context.resolvedSha.slice(0, 8)}</span>
          {" · "}Scope: {context.scopeType}
          {context.detectedLanguages.length > 0 && (
            <>
              {" · "}
              {context.detectedLanguages.join(", ")}
            </>
          )}
          {" · "}
          {context.estimatedFileCount} file stimati
        </p>
        {/* RV.8: avviso non bloccante calcolato dal backend alla creazione del
            contesto. Il campo arrivava nel DTO con un TODO e non veniva mai
            mostrato, quindi l'utente non sapeva che la documentazione generata
            poteva risentire di un README in un'altra lingua. */}
        {context.nonEnglishReadmeDetected && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-[#8a5a00]">
            Il README di questo repository non sembra in inglese: gli agenti lavorano meglio su
            contenuti in inglese, i risultati potrebbero essere meno accurati.
          </p>
        )}
        {/* RF.24: stesso trattamento di RV.8 qui sopra — avviso non bloccante,
            calcolato dal backend alla creazione del contesto. Compare quando il
            linguaggio predominante non e' fra i tre supportati: e' il caso in
            cui l'analisi vedrebbe una frazione minima del repository, e senza
            dirlo un report quasi vuoto sembrerebbe un repository quasi pulito. */}
        {context.unsupportedLanguageWarning && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-[#8a5a00]">
            Questo repository è scritto principalmente in{" "}
            <span className="font-medium">{context.predominantLanguage}</span>, che gli agenti non
            sanno analizzare: verranno esaminati solo i file TypeScript, JavaScript e Python
            {context.detectedLanguages.length === 0 ? ", che qui non risultano presenti" : ""}.
            {context.unsupportedLanguages.length > 1 && (
              <>
                {" "}
                Altri linguaggi non supportati: {context.unsupportedLanguages.slice(1).join(", ")}.
              </>
            )}
          </p>
        )}

        {/* Link to change context */}
        <button
          type="button"
          onClick={() => navigate({ to: "/select" })}
          className="mt-2 text-xs text-[#2277cc] hover:underline"
        >
          Cambia contesto
        </button>
      </div>

      {ops_error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#cc2222]">
          {ops_error}
        </div>
      )}

      {ops_loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner size="sm" />
          Caricamento operazioni…
        </div>
      )}

      {/* Operation cards — multi-select */}
      <p className="mb-3 text-sm font-medium text-[#2a2a2a]">
        Operazioni <span className="font-normal text-gray-400">(puoi selezionarne più di una)</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {available_ops.map((op) => {
          const is_selected = selected_ops.has(op.code);
          return (
            <button
              type="button"
              key={op.code}
              onClick={() => toggle_op(op.code)}
              aria-pressed={is_selected}
              className={[
                "rounded-lg border p-4 text-left transition",
                is_selected
                  ? "border-[#2277cc] bg-[#2277cc]/5 ring-2 ring-[#2277cc]/30"
                  : "border-[#cccccc] bg-white hover:border-[#2277cc]/50 hover:bg-gray-50",
              ].join(" ")}
            >
              {/* Agente che esegue l'operazione (DOCS, SECURITY, CHANGELOG) */}
              <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                {op.agent}
              </span>
              <span className="block text-sm font-medium text-[#2a2a2a]">{op.displayName}</span>
              <span className="mt-1 block text-xs leading-relaxed text-gray-500">
                {op.description}
              </span>
              {/* Visual selected indicator */}
              {is_selected && (
                <span className="mt-2 inline-block rounded-full bg-[#2277cc] px-2 py-0.5 text-[10px] font-semibold text-white">
                  Selezionata
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Error */}
      {launch_error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#cc2222]">
          {launch_error}
        </div>
      )}

      {/* Launch button */}
      <button
        type="button"
        onClick={handle_launch}
        disabled={selected_ops.size === 0 || launching}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded bg-[#2a2a2a] px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-200 transition disabled:opacity-50"
      >
        {launching && <Spinner size="sm" className="text-white" />}
        {selected_ops.size === 0
          ? "Seleziona almeno un'operazione"
          : selected_ops.size === 1
            ? "Avvia operazione"
            : `Avvia ${selected_ops.size} operazioni`}
      </button>
    </div>
  );
}
