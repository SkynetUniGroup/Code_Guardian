import type { TaskDto } from "@codeguardian/shared";
import type { TaskDocument } from "../schemas/task.schema";

export type { TaskDto };

// What GET /tasks and GET /tasks/:id return — the wire shape, not the
// Mongoose document (no contextId, no _id/__v, batchId and operation as
// plain strings).
/*export interface TaskDto {
  id: string;
  batchId: string;
  operation: OperationCode;
  status: TaskStatus;
  progressPercent: number;
  currentStage: string | null;
  reportId: string | null;
  error: TaskError | null;
  pendingInput: PendingInput;
}*/

export function toTaskDto(task: TaskDocument): TaskDto {
  return {
    id: task.id,
    batchId: task.batchId,
    operation: task.operation,
    status: task.status,
    progressPercent: task.progressPercent,
    currentStage: task.currentStage,
    reportId: task.reportId ? task.reportId.toString() : null,
    error: task.error,
    pendingInput: task.pendingInput,
  };
}
