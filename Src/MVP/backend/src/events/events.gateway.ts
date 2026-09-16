import { JwtService } from "@nestjs/jwt";
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { PendingInput, TaskError, TaskStatus } from "../tasks/task.types";

interface HandshakeJwtPayload {
  sub: string;
}

// One room per user ("user:<userId>"), joined automatically once the JWT on
// the connection handshake verifies. This is a deliberate simplification of
// the spec's per-taskId subscription model: every REST endpoint already
// scopes tasks/reports by ownership, so a user only ever needs to see their
// own tasks, and joining by user means the frontend never has to send a
// subscription message after connecting at all — a stricter reading of "the
// frontend never emits application events" than the per-task version.
@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN },
})
export class EventsGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server!: Server;

  constructor(private readonly jwt: JwtService) {}

  handleConnection(client: Socket): void {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwt.verify<HandshakeJwtPayload>(token);
      void client.join(this.roomFor(payload.sub));
    } catch {
      client.disconnect();
    }
  }

  emitTaskProgress(userId: string, taskId: string, stage: string, percent: number): void {
    this.server.to(this.roomFor(userId)).emit("task.progress", { taskId, stage, percent });
  }

  emitTaskUpdated(userId: string, taskId: string, status: TaskStatus, reportId?: string): void {
    this.server.to(this.roomFor(userId)).emit("task.updated", { taskId, status, reportId });
  }

  emitTaskFailed(userId: string, taskId: string, error: TaskError): void {
    this.server.to(this.roomFor(userId)).emit("task.failed", { taskId, error });
  }

  emitBatchCompleted(userId: string, batchId: string, completed: number, failed: number): void {
    this.server.to(this.roomFor(userId)).emit("batch.completed", { batchId, completed, failed });
  }

  // Flat shape — { taskId, kind, taskIds?, technicalChangelog? } — matching
  // how the other four events are shaped, and matching the Progettazione
  // Frontend's own Table 6 rather than nesting a `pendingInput` object.
  // taskId is a deliberate addition beyond that table: a bare PendingInput
  // carries no way to tell the frontend which task it belongs to once more
  // than one is in flight.
  //
  // Il campo del changelog tecnico e' una correzione alla Tabella 6, che lo
  // chiama `reportId`. Non e' solo un nome gia' preso da TaskEntry (il report
  // finale del Task, vedi task.updated): e' che qui **non c'e' nessun report**.
  // Le due fasi di CHANGELOG_BUSINESS stanno dentro un solo Task e il Report
  // nasce alla fine, quindi quando si chiede la conferma non esiste ancora
  // niente a cui puntare. Si manda il testo, prodotto un istante prima.
  emitTaskInputRequired(
    userId: string,
    taskId: string,
    pendingInput: Exclude<PendingInput, null>,
  ): void {
    const taskIds = "taskIds" in pendingInput ? pendingInput.taskIds : undefined;
    const technicalChangelog =
      "technicalChangelog" in pendingInput ? pendingInput.technicalChangelog : undefined;
    const technicalChangelogTruncated =
      "technicalChangelogTruncated" in pendingInput
        ? pendingInput.technicalChangelogTruncated
        : undefined;

    this.server.to(this.roomFor(userId)).emit("task.inputRequired", {
      taskId,
      kind: pendingInput.kind,
      taskIds,
      technicalChangelog,
      technicalChangelogTruncated,
    });
  }

  private roomFor(userId: string): string {
    return `user:${userId}`;
  }
}
