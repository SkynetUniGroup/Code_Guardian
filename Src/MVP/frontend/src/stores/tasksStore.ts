import { create } from 'zustand';
import type {
  TaskEntry,
  TaskStatus,
  TaskUpdatedEvent,
  TaskProgressEvent,
  TaskFailedEvent,
  TaskInputRequiredEvent,
  PendingInput,
} from '../types';

/**
 * Shape of the tasks state slice.
 */
interface TasksState {
  /**
   * All known tasks keyed by their ID.
   * Using a Record rather than an array allows O(1) lookup by ID, which is
   * important because WebSocket events arrive with taskId references only.
   */
  tasks: Record<string, TaskEntry>;
}

/**
 * Shape of the tasks action slice.
 */
interface TasksActions {
  /**
   * Creates or updates a task entry from a task.updated WebSocket event.
   * If the task does not yet exist locally (e.g., created on another session),
   * a skeleton entry is created with sensible defaults.
   */
  upsertFromUpdated: (event: TaskUpdatedEvent) => void;

  /**
   * Updates a task's progress fields from a task.progress WebSocket event.
   * Creates the task entry if it does not yet exist locally.
   */
  upsertFromProgress: (event: TaskProgressEvent) => void;

  /**
   * Marks a task as FAILED and stores its error details.
   * Also handles the CREDENTIAL_INVALID code at the store level (callers
   * should additionally call sessionStore.markCredentialsInvalid()).
   */
  applyFailed: (event: TaskFailedEvent) => void;

  /**
   * Attaches a pending input request to a task.
   * The task card will render the appropriate modal trigger.
   */
  applyInputRequired: (event: TaskInputRequiredEvent) => void;

  /**
   * Clears the pendingInput field after the user submits their response.
   * The task status will be updated by a subsequent task.updated event.
   */
  clearPendingInput: (taskId: string) => void;

  /**
   * Bulk-replaces all tasks from a GET /tasks API response.
   * Called on mount and on WebSocket reconnect to resync state.
   */
  loadTasks: (tasks: TaskEntry[]) => void;

  /**
   * Optimistically marks a task as CANCELLED in the local store.
   * The backend will confirm via a task.updated event.
   */
  cancel: (taskId: string) => void;
}

export type TasksStore = TasksState & TasksActions;

/**
 * Builds a default TaskEntry skeleton for a task ID that is referenced in
 * a WebSocket event but not yet present in the local store.
 */
function makeDefaultEntry(id: string): TaskEntry {
  return {
    id,
    operation: 'DOCS_README', // placeholder, overwritten on first upsert
    status: 'PENDING',
    progressPercent: 0,
    currentStage: null,
    reportId: null,
    error: null,
    pendingInput: null,
  };
}

/**
 * Global tasks store.
 * Maintained by WebSocket events; resynced via GET /tasks on reconnect.
 */
export const useTasksStore = create<TasksStore>((set, get) => ({
  // ---- Initial state ----
  tasks: {},

  // ---- Actions ----

  upsertFromUpdated: (event) => {
    set((state) => {
      const existing = state.tasks[event.taskId] ?? makeDefaultEntry(event.taskId);
      return {
        tasks: {
          ...state.tasks,
          [event.taskId]: {
            ...existing,
            status: event.status,
            reportId: event.reportId ?? existing.reportId,
          },
        },
      };
    });
  },

  upsertFromProgress: (event) => {
    set((state) => {
      const existing = state.tasks[event.taskId] ?? makeDefaultEntry(event.taskId);
      return {
        tasks: {
          ...state.tasks,
          [event.taskId]: {
            ...existing,
            currentStage: event.stage,
            progressPercent: event.percent,
          },
        },
      };
    });
  },

  applyFailed: (event) => {
    set((state) => {
      const existing = state.tasks[event.taskId] ?? makeDefaultEntry(event.taskId);
      return {
        tasks: {
          ...state.tasks,
          [event.taskId]: {
            ...existing,
            status: 'FAILED',
            error: event.error,
          },
        },
      };
    });
  },

  applyInputRequired: (event) => {
    set((state) => {
      const existing = state.tasks[event.taskId] ?? makeDefaultEntry(event.taskId);

      // Build the PendingInput discriminated union from the flat WS event.
      let pending: PendingInput;
      if (event.kind === 'SPRINT_ID') {
        pending = { kind: 'SPRINT_ID' };
      } else if (event.kind === 'INCOMPLETE_TASKS') {
        pending = { kind: 'INCOMPLETE_TASKS', taskIds: event.taskIds ?? [] };
      } else {
        pending = { kind: 'BUSINESS_CONFIRMATION', technicalReportId: event.reportId ?? '' };
      }

      return {
        tasks: {
          ...state.tasks,
          [event.taskId]: { ...existing, pendingInput: pending },
        },
      };
    });
  },

  clearPendingInput: (taskId) => {
    set((state) => {
      const existing = state.tasks[taskId];
      if (!existing) return state;
      return {
        tasks: {
          ...state.tasks,
          [taskId]: { ...existing, pendingInput: null },
        },
      };
    });
  },

  loadTasks: (tasks) => {
    const record: Record<string, TaskEntry> = {};
    for (const t of tasks) {
      record[t.id] = t;
    }
    set({ tasks: record });
  },

  cancel: (taskId) => {
    set((state) => {
      const existing = state.tasks[taskId];
      if (!existing) return state;
      return {
        tasks: {
          ...state.tasks,
          [taskId]: { ...existing, status: 'CANCELLED' },
        },
      };
    });
  },
}));
