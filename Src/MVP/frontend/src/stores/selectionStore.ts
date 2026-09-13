import { create } from "zustand";
import type { AnalysisContextDto, RepositorySummary } from "../types";

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

  /**
   * Form context matching the SelectPage form fields.
   * Used ONLY to repopulate the form when user returns to /select.
   * Populated on successful form submission, cleared on new selection.
   */
  formContext: {
    manual_repo_url: string;
    selected_repo: RepositorySummary | null;
    ref: string;
    commit_sha: string;
    scope_type: string;
    paths_text: string;
  } | null;
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
   * Stores the form context for repopulating the SelectPage form.
   * Called on successful form submission.
   */
  setFormContext: (formData: {
    manual_repo_url: string;
    selected_repo: RepositorySummary | null;
    ref: string;
    commit_sha: string;
    scope_type: string;
    paths_text: string;
  }) => void;

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
  formContext: null,

  // ---- Actions ----

  setContext: (context) => {
    set({ contextId: context.id, context });
  },

  setFormContext: (formData) => {
    set({ formContext: formData });
  },

  clearContext: () => {
    set({ contextId: null, context: null, formContext: null });
  },
}));
