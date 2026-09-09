import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { BusinessConfirmationModal } from "../components/modals/BusinessConfirmationModal";
import { IncompleteTasksModal } from "../components/modals/IncompleteTasksModal";
import { SprintIdModal } from "../components/modals/SprintIdModal";
import { ProgressBar } from "../components/shared/ProgressBar";
import { Spinner } from "../components/shared/Spinner";
import { StatusBadge } from "../components/shared/StatusBadge";
import { useTasksStore } from "../stores/tasksStore";
import type { TaskDto, TaskEntry } from "../types";
import { OPERATION_LABELS } from "../types";

/**
 * TasksPage — /tasks
 *
 * Displays all known tasks with real-time status from the tasksStore,
 * which is kept up-to-date by the WebSocket hook running in AppShell.
 *
 * On mount, fetches the current task list from GET /tasks so the page
 * is populated even when the user navigates here after a page refresh
 * (the WebSocket history is not replayed on reconnect).
 *
 * Interactive areas:
 *  - Tasks with pendingInput render a modal trigger button.
 *  - RUNNING tasks show a progress bar with current stage label.
 *  - PENDING and RUNNING tasks offer a Cancel button.
 *  - COMPLETED tasks with a reportId show a link to the report.
 */
/**
 * Quale modale è aperta e su quale task. Il payload dipende dal `kind`, quindi
 * è una union discriminata e non un `any`: è la stessa forma che PendingInput
 * ha nello store, e tenerla tipizzata evita che una modale legga un campo che
 * per quel kind non esiste.
 */
type ModalRequest =
  | { kind: "SPRINT_ID" }
  | { kind: "INCOMPLETE_TASKS"; taskIds: string[] }
  | { kind: "BUSINESS_CONFIRMATION"; technicalReportId: string };

type ActiveModal = ModalRequest & { taskId: string };

export function TasksPage() {
  const tasks_map = useTasksStore((s) => s.tasks);
  const load_tasks = useTasksStore((s) => s.loadTasks);
  const cancel_task = useTasksStore((s) => s.cancel);

  const [initial_loading, setInitialLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  // Modal state — tracks which task's modal is open and its kind.
  const [active_modal, setActiveModal] = useState<ActiveModal | null>(null);

  // Fetch initial task list on mount.
  useEffect(() => {
    async function fetch_initial() {
      try {
        // GET /tasks risponde con un array nudo (TaskDto[]).
        const response = await apiClient.get<TaskDto[]>("/tasks");
        const mapped: TaskEntry[] = response.data.map((t) => ({
          id: t.id,
          batchId: t.batchId ?? null,
          operation: t.operation,
          status: t.status,
          progressPercent: t.progressPercent ?? 0,
          currentStage: t.currentStage ?? null,
          reportId: t.reportId ?? null,
          error: t.error ?? null,
          // pendingInput e' persistito sul Task, non solo trasmesso via
          // WebSocket: azzerarlo qui faceva sparire il pulsante della modale a
          // ogni refresh, lasciando il task in attesa di una risposta che
          // l'utente non aveva piu' modo di dare.
          pendingInput: t.pendingInput ?? null,
        }));
        load_tasks(mapped);
      } catch {
        // Non-fatal: the WS will keep the list updated in real time.
        console.warn("[TasksPage] Failed to fetch initial task list");
      } finally {
        setInitialLoading(false);
      }
    }
    fetch_initial();
  }, [load_tasks]);

  /** Sends a cancellation request and optimistically updates local state. */
  async function handle_cancel(task_id: string) {
    setCancelling(task_id);
    try {
      await apiClient.post(`/tasks/${task_id}/cancel`);
      cancel_task(task_id);
    } catch {
      // Error is surfaced by the task status card if the WS confirms failure.
    } finally {
      setCancelling(null);
    }
  }

  const task_list = Object.values(tasks_map).sort((a, b) => {
    // Sort by status priority: RUNNING > PENDING > others; then preserve insertion order.
    const priority: Record<string, number> = {
      RUNNING: 0,
      PENDING: 1,
      FAILED: 2,
      COMPLETED: 3,
      CANCELLED: 4,
    };
    return (priority[a.status] ?? 5) - (priority[b.status] ?? 5);
  });

  // ---- Render ----

  if (initial_loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Spinner size="sm" />
        Caricamento task…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-semibold text-[#2a2a2a]">Task</h1>
      <p className="mb-6 text-sm text-gray-400">
        Monitoraggio delle operazioni in esecuzione e completate.
      </p>

      {task_list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#cccccc] p-10 text-center text-sm text-gray-400">
          Nessun task trovato.{" "}
          <Link to="/run" className="text-[#2277cc] hover:underline">
            Avvia un'operazione
          </Link>{" "}
          per cominciare.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {task_list.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              cancelling={cancelling === task.id}
              on_cancel={() => handle_cancel(task.id)}
              on_open_modal={(modal) => setActiveModal({ ...modal, taskId: task.id })}
            />
          ))}
        </ul>
      )}

      {/* ---- Modals ---- */}

      {active_modal?.kind === "SPRINT_ID" && (
        <SprintIdModal taskId={active_modal.taskId} onClose={() => setActiveModal(null)} />
      )}

      {active_modal?.kind === "INCOMPLETE_TASKS" && (
        <IncompleteTasksModal
          taskId={active_modal.taskId}
          taskIds={active_modal.taskIds}
          onClose={() => setActiveModal(null)}
        />
      )}

      {active_modal?.kind === "BUSINESS_CONFIRMATION" && (
        <BusinessConfirmationModal
          taskId={active_modal.taskId}
          technicalReportId={active_modal.technicalReportId}
          onClose={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskCard — internal component
// ---------------------------------------------------------------------------

interface TaskCardProps {
  task: TaskEntry;
  cancelling: boolean;
  on_cancel: () => void;
  on_open_modal: (modal: ModalRequest) => void;
}

/**
 * Single task card rendered in the tasks list.
 * Shows status badge, operation label, progress bar, and contextual actions.
 */
function TaskCard({ task, cancelling, on_cancel, on_open_modal }: TaskCardProps) {
  const can_cancel = task.status === "PENDING" || task.status === "RUNNING";
  // Estratto in una const: TypeScript non mantiene il narrowing di
  // task.pendingInput dentro le callback onClick qui sotto.
  const pending = task.pendingInput;

  return (
    <li className="rounded-lg border border-[#cccccc] bg-gray-50 p-4">
      {/* Top row: operation name + status badge */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-[#2a2a2a] truncate">
            {OPERATION_LABELS[task.operation] ?? task.operation}
          </span>
          <span className="block text-xs text-gray-400 font-mono mt-0.5 truncate">{task.id}</span>
        </div>
        <StatusBadge status={task.status} className="shrink-0" />
      </div>

      {/* Progress bar (only for running tasks) */}
      {task.status === "RUNNING" && (
        <ProgressBar value={task.progressPercent} stage={task.currentStage} className="mb-3" />
      )}

      {/* Error detail for failed tasks */}
      {task.status === "FAILED" && task.error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-[#cc2222]">
          <span className="font-semibold">{task.error.code}:</span> {task.error.message}
          {task.error.stage && (
            <span className="ml-1 text-red-400">(fase: {task.error.stage})</span>
          )}
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Pending input action buttons */}
        {pending?.kind === "SPRINT_ID" && (
          <button
            type="button"
            onClick={() => on_open_modal({ kind: "SPRINT_ID" })}
            className="rounded bg-[#f0ad00] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#c98f00] transition"
          >
            Inserisci Sprint ID
          </button>
        )}

        {pending?.kind === "INCOMPLETE_TASKS" && (
          <button
            type="button"
            onClick={() =>
              on_open_modal({
                kind: "INCOMPLETE_TASKS",
                taskIds: pending.taskIds,
              })
            }
            className="rounded bg-[#f0ad00] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#c98f00] transition"
          >
            Task incompleti — decidi
          </button>
        )}

        {pending?.kind === "BUSINESS_CONFIRMATION" && (
          <button
            type="button"
            onClick={() =>
              on_open_modal({
                kind: "BUSINESS_CONFIRMATION",
                technicalReportId: pending.technicalReportId,
              })
            }
            className="rounded bg-[#f0ad00] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#c98f00] transition"
          >
            Conferma apertura PR
          </button>
        )}

        {/* Report link */}
        {task.status === "COMPLETED" && task.reportId && (
          <Link
            to="/reports/$id"
            params={{ id: task.reportId }}
            className="rounded bg-[#2277cc] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a5fa8] transition"
          >
            Vedi report
          </Link>
        )}

        {/* Cancel button */}
        {can_cancel && (
          <button
            type="button"
            onClick={on_cancel}
            disabled={cancelling}
            className="ml-auto flex items-center gap-1.5 rounded border border-[#cc2222] px-3 py-1.5 text-xs font-medium text-[#cc2222] hover:bg-red-50 transition disabled:opacity-50"
          >
            {cancelling && <Spinner size="sm" className="text-[#cc2222]" />}
            Annulla
          </button>
        )}
      </div>
    </li>
  );
}
