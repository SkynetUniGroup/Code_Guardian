import { useState } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { Spinner } from '../shared/Spinner';
import { apiClient } from '../../api/client';
import { useTasksStore } from '../../stores/tasksStore';
import type { SubmitInputDto } from '../../types';

interface IncompleteTasksModalProps {
  /** ID of the paused task. */
  taskId: string;

  /** List of task IDs that the agent found to be incomplete. */
  taskIds: string[];

  /** Called after a successful submission or explicit cancel. */
  onClose: () => void;
}

/**
 * Modal dialog for the INCOMPLETE_TASKS pending input kind.
 *
 * The Changelog agent may discover that some referenced Jira/Linear tasks are
 * still open. The user can decide whether to PROCEED with the incomplete set or
 * CANCEL the entire operation.
 */
export function IncompleteTasksModal({ taskId, taskIds, onClose }: IncompleteTasksModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const clear_pending = useTasksStore((s) => s.clearPendingInput);

  async function submit(action: 'PROCEED' | 'CANCEL') {
    const dto: SubmitInputDto = { kind: 'INCOMPLETE_TASKS', action };
    setLoading(true);
    setError('');
    try {
      await apiClient.post(`/tasks/${taskId}/input`, dto);
      clear_pending(taskId);
      onClose();
    } catch {
      setError('Impossibile inviare la risposta. Riprova.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalOverlay open title="Task incompleti rilevati" onClose={onClose}>
      <p className="mb-3 text-sm text-gray-500">
        I seguenti task risultano ancora aperti nel sistema di ticketing. Vuoi procedere ugualmente
        con il changelog o annullare l'operazione?
      </p>

      {/* List of incomplete task IDs */}
      <ul className="mb-4 max-h-40 overflow-y-auto rounded border border-[#cccccc] p-2 text-xs font-mono text-gray-700">
        {taskIds.map((id) => (
          <li key={id} className="py-0.5">
            {id}
          </li>
        ))}
      </ul>

      {error && <p className="mb-3 text-xs text-[#cc2222]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={() => submit('CANCEL')}
          disabled={loading}
          className="rounded border border-[#cccccc] px-4 py-2 text-sm text-[#2a2a2a] hover:bg-gray-50 transition disabled:opacity-50"
        >
          Annulla operazione
        </button>

        <button
          onClick={() => submit('PROCEED')}
          disabled={loading}
          className="flex items-center gap-2 rounded bg-[#2277cc] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a5fa8] transition disabled:opacity-50"
        >
          {loading && <Spinner size="sm" className="text-white" />}
          Procedi comunque
        </button>
      </div>
    </ModalOverlay>
  );
}
