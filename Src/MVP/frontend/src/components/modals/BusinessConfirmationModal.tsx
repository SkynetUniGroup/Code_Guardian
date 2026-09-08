import { useState } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { Spinner } from '../shared/Spinner';
import { apiClient } from '../../api/client';
import { useTasksStore } from '../../stores/tasksStore';
import type { SubmitInputDto } from '../../types';

interface BusinessConfirmationModalProps {
  /** ID of the paused task (CHANGELOG_BUSINESS). */
  taskId: string;

  /** ID of the technical report generated in the preceding step. */
  technicalReportId: string;

  /** Called after submission or cancel. */
  onClose: () => void;
}

/**
 * Modal dialog for the BUSINESS_CONFIRMATION pending input kind.
 *
 * After the technical changelog is generated, the Changelog agent pauses and
 * asks the PM to review and confirm before opening the GitHub PR. The user can
 * inspect the technical report and then choose to PROCEED (open PR) or CANCEL.
 */
export function BusinessConfirmationModal({
  taskId,
  technicalReportId,
  onClose,
}: BusinessConfirmationModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const clear_pending = useTasksStore((s) => s.clearPendingInput);

  async function submit(action: 'PROCEED' | 'CANCEL') {
    const dto: SubmitInputDto = { kind: 'BUSINESS_CONFIRMATION', action };
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
    <ModalOverlay open title="Conferma apertura PR" onClose={onClose}>
      <p className="mb-4 text-sm text-gray-500">
        Il changelog tecnico è stato generato. Vuoi procedere con l'apertura della Pull Request
        su GitHub? Puoi consultare il report tecnico prima di confermare.
      </p>

      {/* Link to the technical report for review */}
      <div className="mb-4 rounded border border-[#cccccc] p-3 text-sm">
        <span className="font-medium text-[#2a2a2a]">Report tecnico: </span>
        <a
          href={`/reports/${technicalReportId}`}
          target="_blank"
          rel="noreferrer"
          className="text-[#2277cc] underline hover:no-underline"
        >
          Visualizza →
        </a>
      </div>

      {error && <p className="mb-3 text-xs text-[#cc2222]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={() => submit('CANCEL')}
          disabled={loading}
          className="rounded border border-[#cccccc] px-4 py-2 text-sm text-[#2a2a2a] hover:bg-gray-50 transition disabled:opacity-50"
        >
          Annulla
        </button>

        <button
          onClick={() => submit('PROCEED')}
          disabled={loading}
          className="flex items-center gap-2 rounded bg-[#2a8a2a] px-4 py-2 text-sm font-medium text-white hover:bg-[#1e6b1e] transition disabled:opacity-50"
        >
          {loading && <Spinner size="sm" className="text-white" />}
          Apri Pull Request
        </button>
      </div>
    </ModalOverlay>
  );
}
