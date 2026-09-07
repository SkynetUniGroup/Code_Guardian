import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { TaskError, TaskStatus } from './task.types';
import { TaskDocument } from './schemas/task.schema';
import { AgentRegistry } from '../operations/agent-registry.service';
import { AgentStartRequest, AgentStepResult } from './agent-client.types';
import { mapAgentErrorKind } from './agent-error-mapping';

export interface AgentInvocationResult {
  status: Extract<TaskStatus, 'COMPLETED' | 'FAILED'>;
  error?: TaskError;
}

// HTTP margin added on top of the agent's own timeout budget (Tabella 45),
// so the gateway never times out before the agent itself would.
const HTTP_TIMEOUT_MARGIN_S = 5;

@Injectable()
export class AgentInvocationService {
  constructor(
    private readonly config: ConfigService,
    private readonly agentRegistry: AgentRegistry,
  ) {}

  async invoke(task: TaskDocument): Promise<AgentInvocationResult> {
    const threadId = task.lgThreadId ?? randomUUID();
    if (!task.lgThreadId) {
      task.lgThreadId = threadId;
      await task.save();
    }

    const body: AgentStartRequest = {
      taskId: task.id,
      threadId,
      operationCode: task.operation,
      payload: {},
    };

    const timeoutMs =
      (this.agentRegistry.getTimeoutS(task.operation) + HTTP_TIMEOUT_MARGIN_S) *
      1000;
    const baseUrl = this.config.get<string>('AGENTS_SERVICE_URL');

    let result: AgentStepResult;
    try {
      const res = await fetch(`${baseUrl}/internal/agent/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return this.failure(
          'UPSTREAM',
          `Agent service responded ${res.status}`,
        );
      }
      result = (await res.json()) as AgentStepResult;
    } catch (err) {
      // The agent didn't respond at all within our budget — we don't know
      // why, so this is UPSTREAM, not TIMEOUT. TIMEOUT is reserved for the
      // agent itself reporting that its own model call timed out (handled
      // below via mapAgentErrorKind).
      if (err instanceof Error && err.name === 'TimeoutError') {
        return this.failure('UPSTREAM', 'Agent invocation timed out');
      }
      return this.failure(
        'UPSTREAM',
        err instanceof Error ? err.message : 'Agent invocation failed',
      );
    }

    if (result.status === 'completed') {
      // result.result (the agent's actual output) is intentionally dropped
      // here — persisting it as a Report is BE-18, not built yet.
      return { status: 'COMPLETED' };
    }

    if (result.status === 'interrupted') {
      return this.failure(
        'UPSTREAM',
        'Pause/resume not implemented yet (BE-17)',
      );
    }

    return this.failure(
      mapAgentErrorKind(result.error),
      result.error ?? 'Agent execution failed',
    );
  }

  private failure(
    code: TaskError['code'],
    message: string,
  ): AgentInvocationResult {
    return { status: 'FAILED', error: { code, message, stage: 'EXECUTION' } };
  }
}
