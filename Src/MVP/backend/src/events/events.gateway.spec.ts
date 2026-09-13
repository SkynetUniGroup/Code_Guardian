import { type Mock, vi } from "vitest";
import { EventsGateway } from "./events.gateway";

function makeClient(token?: string) {
  return {
    handshake: { auth: token ? { token } : {} },
    join: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe("EventsGateway", () => {
  describe("handleConnection", () => {
    it("disconnects a client that sends no token", () => {
      const jwt = { verify: vi.fn() };
      const gateway = new EventsGateway(jwt as never);
      const client = makeClient(undefined);

      gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
      expect(jwt.verify).not.toHaveBeenCalled();
    });

    it("disconnects a client whose token fails verification", () => {
      const jwt = {
        verify: vi.fn(() => {
          throw new Error("invalid signature");
        }),
      };
      const gateway = new EventsGateway(jwt as never);
      const client = makeClient("bad-token");

      gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it("joins a per-user room when the token verifies", () => {
      const jwt = { verify: vi.fn(() => ({ sub: "user-42" })) };
      const gateway = new EventsGateway(jwt as never);
      const client = makeClient("good-token");

      gateway.handleConnection(client as never);

      expect(client.join).toHaveBeenCalledWith("user:user-42");
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });

  describe("emit methods", () => {
    it("emitTaskProgress targets the caller-supplied user room with the exact event contract", () => {
      const server = { to: vi.fn().mockReturnThis(), emit: vi.fn() };
      const gateway = new EventsGateway({} as never);
      (gateway as unknown as { server: typeof server }).server = server;

      gateway.emitTaskProgress("user-1", "task-1", "analyzing", 50);

      expect(server.to).toHaveBeenCalledWith("user:user-1");
      expect(server.emit).toHaveBeenCalledWith("task.progress", {
        taskId: "task-1",
        stage: "analyzing",
        percent: 50,
      });
    });

    describe("emitTaskInputRequired", () => {
      function emit(server: { to: Mock; emit: Mock }) {
        const gateway = new EventsGateway({} as never);
        (gateway as unknown as { server: typeof server }).server = server;
        return gateway;
      }

      it("flattens the SPRINT_ID variant with no extra fields", () => {
        const server = { to: vi.fn().mockReturnThis(), emit: vi.fn() };
        emit(server).emitTaskInputRequired("user-1", "task-1", {
          kind: "SPRINT_ID",
        });

        expect(server.to).toHaveBeenCalledWith("user:user-1");
        expect(server.emit).toHaveBeenCalledWith("task.inputRequired", {
          taskId: "task-1",
          kind: "SPRINT_ID",
          taskIds: undefined,
          technicalChangelog: undefined,
          technicalChangelogTruncated: undefined,
        });
      });

      it("flattens the INCOMPLETE_TASKS variant, carrying taskIds", () => {
        const server = { to: vi.fn().mockReturnThis(), emit: vi.fn() };
        emit(server).emitTaskInputRequired("user-1", "task-1", {
          kind: "INCOMPLETE_TASKS",
          taskIds: ["issue-1", "issue-2"],
        });

        expect(server.emit).toHaveBeenCalledWith("task.inputRequired", {
          taskId: "task-1",
          kind: "INCOMPLETE_TASKS",
          taskIds: ["issue-1", "issue-2"],
          technicalChangelog: undefined,
          technicalChangelogTruncated: undefined,
        });
      });

      // Il changelog tecnico viaggia come testo, non come id: quando si chiede
      // la conferma il Report non esiste ancora (le due fasi stanno dentro un
      // solo Task). Vedi il commento su emitTaskInputRequired.
      it("flattens the BUSINESS_CONFIRMATION variant carrying the technical changelog text", () => {
        const server = { to: vi.fn().mockReturnThis(), emit: vi.fn() };
        emit(server).emitTaskInputRequired("user-1", "task-1", {
          kind: "BUSINESS_CONFIRMATION",
          technicalChangelog: "## Sprint 3\n\n- #12 login",
          technicalChangelogTruncated: false,
        });

        expect(server.emit).toHaveBeenCalledWith("task.inputRequired", {
          taskId: "task-1",
          kind: "BUSINESS_CONFIRMATION",
          taskIds: undefined,
          technicalChangelog: "## Sprint 3\n\n- #12 login",
          technicalChangelogTruncated: false,
        });
      });
    });
  });
});
