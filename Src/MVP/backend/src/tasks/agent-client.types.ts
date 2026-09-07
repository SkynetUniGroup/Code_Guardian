import type { OperationCode } from '../common/domain-types';
import type { PendingInput } from './task.types';

// POST /internal/agent/start body.
export interface AgentStartRequest {
  taskId: string;
  threadId: string;
  operationCode: OperationCode;
  payload: object;
}

// Response shape shared by /start and /resume.
export interface AgentStepResult {
  status: 'interrupted' | 'completed' | 'failed';
  pendingInput?: PendingInput;
  result?: object;
  error?: string;
}
