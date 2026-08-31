import { Injectable } from '@nestjs/common';
import { TaskError, TaskStatus } from './task.types';
import { TaskDocument } from './schemas/task.schema';

export interface AgentInvocationResult {
  status: Extract<TaskStatus, 'COMPLETED' | 'FAILED'>;
  error?: TaskError;
}

// Placeholder for BE-15 (agent invocation gateway): TaskProcessor needs
// something to call for "actually run the operation" to be a complete,
// testable feature, but invoking the Python agent service is BE-15's job,
// not built yet. This always fails rather than faking success, on purpose —
// a genuine COMPLETED task should carry a Report (BE-18, also not built
// yet), so pretending to complete would produce a Task that lies about
// having output. Failing keeps the FAILED path — and its error/WS wiring —
// real and exercisable in the meantime.
//
// BE-15 replaces the body of invoke() with a real call to the agent
// service; nothing in TaskProcessor or TasksService needs to change when it
// does, this class is the entire seam between them.
@Injectable()
export class AgentInvocationService {
  invoke(task: TaskDocument): Promise<AgentInvocationResult> {
    // Not yet used — kept as a real parameter (not dropped) so the
    // signature already matches what BE-15's real implementation needs.
    void task;
    return Promise.resolve({
      status: 'FAILED',
      error: {
        code: 'UPSTREAM',
        message: 'Agent invocation not implemented yet (BE-15)',
        stage: 'EXECUTION',
      },
    });
  }
}
