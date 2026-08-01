import { create } from 'zustand';
import { Report, Task, OperationCode, ReportStatus } from '../types';

interface AnalysisContext {
  id: string;
  repoOwner: string;
  repoName: string;
  ref: string;
  scope: string;
}

interface AppState {
  contexts: AnalysisContext[];
  tasks: Task[];
  reports: Record<string, Report>;
  currentTaskId: string | null;
  websocketConnected: boolean;
}

interface AppActions {
  addContext: (context: AnalysisContext) => void;
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  setCurrentTask: (taskId: string | null) => void;
  addReport: (report: Report) => void;
  setWebSocketConnected: (connected: boolean) => void;
}

type AppStore = AppState & AppActions;

export const useAppStore = create<AppStore>((set) => ({
  // State
  contexts: [],
  tasks: [],
  reports: {},
  currentTaskId: null,
  websocketConnected: false,

  // Actions
  addContext: (context) => set((state) => ({
    contexts: [...state.contexts, context]
  })),

  setTasks: (tasks) => set({ tasks }),

  addTask: (task) => set((state) => ({
    tasks: [...state.tasks, task]
  })),

  updateTask: (taskId, updates) => set((state) => ({
    tasks: state.tasks.map(t =>
      t.id === taskId ? { ...t, ...updates } : t
    )
  })),

  setCurrentTask: (taskId) => set({ currentTaskId: taskId }),

  addReport: (report) => set((state) => ({
    reports: { ...state.reports, [report._id]: report }
  })),

  setWebSocketConnected: (connected) => set({ websocketConnected: connected }),
}));