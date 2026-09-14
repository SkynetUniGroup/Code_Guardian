import { create } from "zustand";
import { OperationCode, type Report, type TaskEntry } from "../types";

interface AnalysisContext {
  id: string;
  repoOwner: string;
  repoName: string;
  ref: string;
  scope: string;
}

interface AppState {
  contexts: AnalysisContext[];
  tasks: TaskEntry[];
  reports: Record<string, Report>;
  currentTaskId: string | null;
  websocketConnected: boolean;
  isConfigured: boolean;
  formData: {
    repoOwner: string;
    repoName: string;
    ref: string;
    scope: string;
  } | null;
}

interface AppActions {
  addContext: (context: AnalysisContext) => void;
  setTasks: (tasks: TaskEntry[]) => void;
  addTask: (task: TaskEntry) => void;
  updateTask: (taskId: string, updates: Partial<TaskEntry>) => void;
  setCurrentTask: (taskId: string | null) => void;
  addReport: (report: Report) => void;
  setWebSocketConnected: (connected: boolean) => void;
  setConfigured: (status: boolean) => void;
  setFormData: (data: { repoOwner: string; repoName: string; ref: string; scope: string }) => void;
}

type AppStore = AppState & AppActions;

export const useAppStore = create<AppStore>((set) => ({
  // State
  contexts: [],
  tasks: [],
  reports: {},
  currentTaskId: null,
  websocketConnected: false,
  // Does not derive from a possibly present JWT: the JWT from the silent login
  // does not imply that the GitHub PAT has been saved. It always starts from
  // the setup screen, which is the only one that sets it to true (after the
  // successful save of the GitHub credential).
  isConfigured: false,
  formData: null,

  // Actions
  addContext: (context) =>
    set((state) => ({
      contexts: [...state.contexts, context],
    })),

  setTasks: (tasks) => set({ tasks }),

  addTask: (task) =>
    set((state) => ({
      tasks: [...state.tasks, task],
    })),

  updateTask: (taskId, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
    })),

  setCurrentTask: (taskId) => set({ currentTaskId: taskId }),

  addReport: (report) =>
    set((state) => ({
      reports: { ...state.reports, [report.id]: report },
    })),

  setWebSocketConnected: (connected) => set({ websocketConnected: connected }),

  setConfigured: (status) => set({ isConfigured: status }),

  setFormData: (data) => set({ formData: data }),
}));
