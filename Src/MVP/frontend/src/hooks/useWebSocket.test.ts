import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "../stores/sessionStore";
import { useTasksStore } from "../stores/tasksStore";
import type { TaskEntry } from "../types";

// --- Mock di socket.io-client -----------------------------------------
// Simuliamo un socket come un semplice event-emitter cosi' da poter
// scatenare a mano gli eventi ('connect', 'task.updated', ecc.) e verificare
// come l'hook reagisce, senza aprire nessuna connessione di rete reale.
class FakeSocket {
  private handlers = new Map<string, Set<(...args: any[]) => void>>();
  disconnect = vi.fn();
  io = { on: this.on.bind(this) };

  on(event: string, handler: (...args: any[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)?.add(handler);
  }

  off(event: string, handler?: (...args: any[]) => void) {
    if (!this.handlers.has(event)) return;
    if (handler) this.handlers.get(event)?.delete(handler);
    else this.handlers.delete(event);
  }

  emit(event: string, payload?: unknown) {
    this.handlers.get(event)?.forEach((h) => {
      h(payload);
    });
  }

  listenerCount(event: string) {
    return this.handlers.get(event)?.size ?? 0;
  }
}

let lastSocket: FakeSocket | null = null;
const ioMock = vi.fn((..._args: any[]) => {
  lastSocket = new FakeSocket();
  return lastSocket;
});

vi.mock("socket.io-client", () => ({
  io: (...args: any[]) => ioMock(...args),
}));

// Mock apiClient for resync
const getMock = vi.fn();
vi.mock("../api/client", () => ({
  apiClient: {
    get: (...args: any[]) => getMock(...args),
  },
}));

const { useWebSocket } = await import("./useWebSocket");

const initialSessionState = useSessionStore.getState();
const initialTasksState = useTasksStore.getState();

const makeTask = (overrides: Partial<TaskEntry> = {}): TaskEntry => ({
  id: "task-1",
  batchId: null,
  contextId: "ctx-1",
  operation: "SECURITY_OWASP",
  status: "PENDING",
  progressPercent: 0,
  currentStage: null,
  reportId: null,
  error: null,
  pendingInput: null,
  ...overrides,
});

beforeEach(() => {
  useSessionStore.setState(initialSessionState, true);
  useTasksStore.setState(initialTasksState, true);
  lastSocket = null;
  ioMock.mockClear();
  getMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("useWebSocket", () => {
  it("non tenta la connessione websocket se non c'e' un token nello store", async () => {
    // Token e' null per default
    renderHook(() => useWebSocket());

    await waitFor(() => expect(ioMock).not.toHaveBeenCalled());
  });

  it("apre la connessione websocket quando c'e' un token nello store", async () => {
    useSessionStore
      .getState()
      .login({ id: "user-1", firstName: "Test", role: "DEVELOPER" }, "jwt-xyz");

    renderHook(() => useWebSocket());

    await waitFor(() => expect(ioMock).toHaveBeenCalledTimes(1));
    expect(lastSocket).not.toBeNull();
  });

  it("registra gli handler per gli eventi connect e disconnect", async () => {
    useSessionStore
      .getState()
      .login({ id: "user-1", firstName: "Test", role: "DEVELOPER" }, "jwt-xyz");
    renderHook(() => useWebSocket());
    await waitFor(() => expect(lastSocket).not.toBeNull());

    expect(lastSocket?.listenerCount("connect")).toBeGreaterThan(0);
    expect(lastSocket?.listenerCount("disconnect")).toBeGreaterThan(0);
  });

  it("task.progress aggiorna progressPercent e currentStage della task", async () => {
    useSessionStore
      .getState()
      .login({ id: "user-1", firstName: "Test", role: "DEVELOPER" }, "jwt-xyz");
    useTasksStore.getState().loadTasks([makeTask({ id: "task-1", status: "PENDING" })]);

    renderHook(() => useWebSocket());
    await waitFor(() => expect(lastSocket).not.toBeNull());

    act(() =>
      lastSocket?.emit("task.progress", { taskId: "task-1", stage: "analyzing", percent: 40 }),
    );

    const task = useTasksStore.getState().tasks["task-1"];
    expect(task.progressPercent).toBe(40);
    expect(task.currentStage).toBe("analyzing");
  });

  it("task.updated con status COMPLETED aggiorna la task", async () => {
    useSessionStore
      .getState()
      .login({ id: "user-1", firstName: "Test", role: "DEVELOPER" }, "jwt-xyz");
    useTasksStore.getState().loadTasks([makeTask({ id: "task-1", status: "RUNNING" })]);

    renderHook(() => useWebSocket());
    await waitFor(() => expect(lastSocket).not.toBeNull());

    act(() =>
      lastSocket?.emit("task.updated", {
        taskId: "task-1",
        status: "COMPLETED",
        reportId: "report-1",
      }),
    );

    const task = useTasksStore.getState().tasks["task-1"];
    expect(task.status).toBe("COMPLETED");
    expect(task.reportId).toBe("report-1");
  });

  it("task.failed porta la task in stato FAILED", async () => {
    useSessionStore
      .getState()
      .login({ id: "user-1", firstName: "Test", role: "DEVELOPER" }, "jwt-xyz");
    useTasksStore.getState().loadTasks([makeTask({ id: "task-1", status: "RUNNING" })]);

    renderHook(() => useWebSocket());
    await waitFor(() => expect(lastSocket).not.toBeNull());

    act(() =>
      lastSocket?.emit("task.failed", {
        taskId: "task-1",
        error: { code: "TIMEOUT", message: "timeout LLM", stage: "invoca_llm" },
      }),
    );

    const task = useTasksStore.getState().tasks["task-1"];
    expect(task.status).toBe("FAILED");
    expect(task.error).toEqual({ code: "TIMEOUT", message: "timeout LLM", stage: "invoca_llm" });
  });

  it("task.failed con CREDENTIAL_INVALID marca le credenziali come non valide", async () => {
    useSessionStore
      .getState()
      .login({ id: "user-1", firstName: "Test", role: "DEVELOPER" }, "jwt-xyz");
    useTasksStore.getState().loadTasks([makeTask({ id: "task-1", status: "RUNNING" })]);

    renderHook(() => useWebSocket());
    await waitFor(() => expect(lastSocket).not.toBeNull());

    act(() =>
      lastSocket?.emit("task.failed", {
        taskId: "task-1",
        error: { code: "CREDENTIAL_INVALID", message: "invalid creds", stage: "auth" },
      }),
    );

    expect(useSessionStore.getState().credentialsStatus).toBe("INVALID");
  });

  it("batch.completed viene loggato senza alterare lo stato dello store", async () => {
    useSessionStore
      .getState()
      .login({ id: "user-1", firstName: "Test", role: "DEVELOPER" }, "jwt-xyz");
    renderHook(() => useWebSocket());
    await waitFor(() => expect(lastSocket).not.toBeNull());

    act(() =>
      lastSocket?.emit("batch.completed", {
        batchId: "batch-1",
        completed: ["task-1"],
        failed: [],
      }),
    );

    expect(console.info).toHaveBeenCalledWith("[WS] Batch completed:", "batch-1");
  });

  it("allo smontaggio disconnette il socket", async () => {
    useSessionStore
      .getState()
      .login({ id: "user-1", firstName: "Test", role: "DEVELOPER" }, "jwt-xyz");
    const { unmount } = renderHook(() => useWebSocket());
    await waitFor(() => expect(lastSocket).not.toBeNull());
    const socket = lastSocket!;

    expect(socket.listenerCount("task.updated")).toBeGreaterThan(0);

    unmount();

    // Verifica che disconnect sia stato chiamato
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it("chiude il socket precedente e ne apre uno nuovo quando il token cambia", async () => {
    useSessionStore
      .getState()
      .login({ id: "user-1", firstName: "Test", role: "DEVELOPER" }, "jwt-old");

    const { rerender } = renderHook(() => useWebSocket());
    await waitFor(() => expect(ioMock).toHaveBeenCalledTimes(1));
    const firstSocket = lastSocket;

    // Cambia token
    useSessionStore
      .getState()
      .login({ id: "user-1", firstName: "Test", role: "DEVELOPER" }, "jwt-new");
    rerender();

    await waitFor(() => expect(ioMock).toHaveBeenCalledTimes(2));
    expect(firstSocket?.disconnect).toHaveBeenCalledTimes(1);
    expect(lastSocket).not.toBe(firstSocket);
  });
});
