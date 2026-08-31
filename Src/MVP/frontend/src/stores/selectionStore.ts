import { create } from 'zustand';
import type { AnalysisContextDto } from '../types';

/**
 * Shape of the selection state slice.
 * Populated by the /select page after the user configures and submits a context.
 * Consumed by the /run page to know which context and scope to operate on.
 */
interface SelectionState {
  /**
   * The ID of the AnalysisContext created via POST /contexts.
   * Null until the user completes the selection flow.
   */
  contextId: string | null;

  /**
   * Full context DTO returned by the backend.
   * Provides the /run page with metadata (repo name, scope, detected languages)
   * so it can render an informative summary without a second API call.
   */
  context: AnalysisContextDto | null;
}

/**
 * Shape of the selection action slice.
 */
interface SelectionActions {
  /**
   * Stores the context created on the /select page.
   * Called immediately after a successful POST /contexts response.
   */
  setContext: (context: AnalysisContextDto) => void;

  /**
   * Clears the current selection.
   * Called when the user navigates back to /select to start over,
   * or when a batch of tasks is successfully submitted on /run.
   */
  clearContext: () => void;
}

export type SelectionStore = SelectionState & SelectionActions;

/**
 * Global selection store.
 * Acts as the bridge between the /select page (context creation) and the
 * /run page (operation selection and task submission).
 * Does not persist to Web Storage — context must be re-created on page refresh.
 */
export const useSelectionStore = create<SelectionStore>((set) => ({
  // ---- Initial state ----
  contextId: null,
  context: null,

  // ---- Actions ----

  setContext: (context) => {
    set({ contextId: context.id, context });
  },

  clearContext: () => {
    set({ contextId: null, context: null });
  },
}));
