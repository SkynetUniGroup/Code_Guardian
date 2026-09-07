import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSessionStore } from '../stores/sessionStore';
import { useSelectionStore } from '../stores/selectionStore';
import { apiClient } from '../api/client';
import { Spinner } from '../components/shared/Spinner';
import { ErrorState } from '../components/shared/ErrorState';
import { ROLE_OPERATIONS, OPERATION_LABELS } from '../types';
import type { CreateTaskBatchDto, OperationCode } from '../types';

/**
 * RunPage — /run
 *
 * Displays the operations available to the current user based on their role
 * (ROLE_OPERATIONS mapping from Progettazione.pdf Table 10).
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
  const user = useSessionStore((s) => s.user);
  const { contextId, context } = useSelectionStore();

  // Set of selected operations — the batch can contain more than one.
  const [selected_ops, setSelectedOps] = useState<Set<OperationCode>>(new Set());
  const [launching, setLaunching] = useState(false);
  const [launch_error, setLaunchError] = useState('');

  /**
   * Returns the list of operations available to the current user based on role.
   * Source: ROLE_OPERATIONS constant in types/index.ts.
   */
  const available_ops: OperationCode[] = user ? ROLE_OPERATIONS[user.role] : [];

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
    setLaunchError('');
  }

  async function handle_launch() {
    if (selected_ops.size === 0 || !contextId) return;

    setLaunching(true);
    setLaunchError('');

    const dto: CreateTaskBatchDto = {
      contextId,
      operations: Array.from(selected_ops),
    };

    try {
      await apiClient.post('/tasks', dto);
      // Clear the stored context — the user must go through /select again for
      // a new batch to avoid accidentally reusing a stale context.
      navigate({ to: '/tasks' });
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 402) {
        setLaunchError(
          'Limite di utilizzo del modello AI raggiunto; riprova successivamente.',
        );
      } else if (status === 404) {
        setLaunchError(
          'Contesto non trovato. Torna a Repository e ricrea il contesto di analisi.',
        );
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
            onClick={() => navigate({ to: '/select' })}
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
          {' · '}Scope: {context.scopeType}
          {context.detectedLanguages.length > 0 && (
            <>{' · '}{context.detectedLanguages.join(', ')}</>
          )}
          {' · '}{context.estimatedFileCount} file stimati
        </p>
        {/* Link to change context */}
        <button
          onClick={() => navigate({ to: '/select' })}
          className="mt-2 text-xs text-[#2277cc] hover:underline"
        >
          Cambia contesto
        </button>
      </div>

      {/* Operation cards — multi-select */}
      <p className="mb-3 text-sm font-medium text-[#2a2a2a]">
        Operazioni{' '}
        <span className="font-normal text-gray-400">(puoi selezionarne più di una)</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {available_ops.map((op) => {
          const is_selected = selected_ops.has(op);
          return (
            <button
              key={op}
              onClick={() => toggle_op(op)}
              aria-pressed={is_selected}
              className={[
                'rounded-lg border p-4 text-left transition',
                is_selected
                  ? 'border-[#2277cc] bg-[#2277cc]/5 ring-2 ring-[#2277cc]/30'
                  : 'border-[#cccccc] bg-white hover:border-[#2277cc]/50 hover:bg-gray-50',
              ].join(' ')}
            >
              {/* Operation category prefix (e.g. "DOCS", "SECURITY") */}
              <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                {op.split('_')[0]}
              </span>
              <span className="block text-sm font-medium text-[#2a2a2a]">
                {OPERATION_LABELS[op]}
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
        onClick={handle_launch}
        disabled={selected_ops.size === 0 || launching}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded bg-[#2a2a2a] px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-200 transition disabled:opacity-50"
      >
        {launching && <Spinner size="sm" className="text-white" />}
        {selected_ops.size === 0
          ? 'Seleziona almeno un\'operazione'
          : selected_ops.size === 1
            ? 'Avvia operazione'
            : `Avvia ${selected_ops.size} operazioni`}
      </button>
    </div>
  );
}
