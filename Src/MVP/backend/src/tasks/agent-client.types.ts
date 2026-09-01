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

// POST /internal/agent/resume body. Mirrors AgentStartRequest's three
// identity fields (taskId, threadId, operationCode) rather than the bare
// {threadId, inputValue} pair from the agents/backend design doc (§49.1,
// listing 27): the agent service is stateless between HTTP calls, so
// threadId alone isn't enough for it to route back to get_agent_components
// and rebuild the GitHubToolset for that operation/context — it needs the
// same fields /start already sends, not just the LangGraph checkpoint id.
export interface AgentResumeRequest {
  taskId: string;
  threadId: string;
  operationCode: OperationCode;
  inputValue: unknown;
}
