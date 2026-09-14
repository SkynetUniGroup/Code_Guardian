import { useState } from "react";
import { apiClient } from "../../api/client";
import { useTasksStore } from "../../stores/tasksStore";
import type { SubmitInputDto } from "../../types";
import { Spinner } from "../shared/Spinner";
import { ValidatedField } from "../shared/ValidatedField";
import { ModalOverlay } from "./ModalOverlay";

interface SprintIdModalProps {
  /** ID of the task that is waiting for the Sprint ID. */
  taskId: string;

  /** Called when the modal should be closed (after submission or on cancel). */
  onClose: () => void;
}

/**
 * Modal dialog for the SPRINT_ID pending input kind.
 *
 * Displayed when the Changelog agent requires the Sprint identifier before
 * proceeding with commit-to-sprint association. The user enters the Sprint ID
 * and the value is sent to POST /tasks/:id/input.
 */
export function SprintIdModal({ taskId, onClose }: SprintIdModalProps) {
  const [sprint_id, setSprintId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const clear_pending = useTasksStore((s) => s.clearPendingInput);

  async function handle_submit(e: React.FormEvent) {
    e.preventDefault();

    const trimmed = sprint_id.trim();
    if (!trimmed) {
      setError("Please enter a valid Sprint ID");
      return;
    }

    const dto: SubmitInputDto = { kind: "SPRINT_ID", sprintId: trimmed };

    setLoading(true);
    setError("");
    try {
      await apiClient.post(`/tasks/${taskId}/input`, dto);
      clear_pending(taskId);
      onClose();
    } catch {
      setError("Unable to send the Sprint ID. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalOverlay open title="Enter Sprint ID" onClose={onClose}>
      <p className="mb-4 text-sm text-gray-500">
        The agent requires the Sprint identifier to associate the changes with the correct
        cycle. Enter the Sprint number or code (e.g.{" "}
        <code className="font-mono">SPRINT-42</code>).
      </p>

      <form onSubmit={handle_submit} className="flex flex-col gap-4">
        <ValidatedField
          label="Sprint ID"
          placeholder="e.g. SPRINT-42"
          value={sprint_id}
          onChange={(e) => {
            setSprintId(e.target.value);
            setError("");
          }}
          error={error}
          autoFocus
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded border border-[#cccccc] px-4 py-2 text-sm text-[#2a2a2a] hover:bg-gray-50 transition disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={loading || !sprint_id.trim()}
            className="flex items-center gap-2 rounded bg-[#2277cc] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a5fa8] transition disabled:opacity-50"
          >
            {loading && <Spinner size="sm" className="text-white" />}
            Confirm
          </button>
        </div>
      </form>
    </ModalOverlay>
  );
}
