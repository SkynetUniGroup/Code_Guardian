import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Job } from 'bullmq';
import { Task, TaskDocument } from './schemas/task.schema';
import {
  AgentInvocationResult,
  AgentInvocationService,
} from './agent-invocation.service';
import { AgentRunPayload } from './agent-client.types';
import { TaskError } from './task.types';
import { AgentRegistry } from '../operations/agent-registry.service';
import { EventsGateway } from '../events/events.gateway';
import { ReportAssemblyService } from '../reports/report-assembly.service';

// Two job shapes on the same 'tasks' queue: a plain {taskId} is either a
// brand-new PENDING pickup, or (BE-17) a Changelog Task whose sprintId was
// just answered — both reach startOrPause() below and it's the Task's own
// status/sprintId that tells them apart, not the job. {taskId, inputValue}
// is a resume: an already-RUNNING Task whose INCOMPLETE_TASKS or
// BUSINESS_CONFIRMATION pendingInput was just cleared by
// TasksService.submitInput, carrying whatever the agent should be resumed
// with.
export type RunTaskJobData =
  { taskId: string } | { taskId: string; inputValue: unknown };

function isResumeJob(
  data: RunTaskJobData,
): data is Extract<RunTaskJobData, { inputValue: unknown }> {
  return 'inputValue' in data;
}

// The queue consumer (PoC's TaskProcessor, fig. 7/8). One job per Task,
// picked up independently — RF.48's "a failing job doesn't drag down the
// others" is BullMQ's normal per-job isolation, as long as this class never
// lets an error escape process() uncaught, which is why the agent
// invocation is wrapped in try/catch below rather than left to propagate.
//
// BE-17 adds the resume shape to this same Processor rather than a separate
// one: a resume is still "run this Task's next step", it just starts from
// RUNNING instead of PENDING and calls a different AgentInvocationService
// method — keeping both here means the COMPLETED/FAILED/INTERRUPTED
// handling and the batch-completed check only exist once. BE-18 hangs the
// Report assembly off that same single handling point.
@Processor('tasks')
export class TaskProcessor extends WorkerHost {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    private readonly events: EventsGateway,
    private readonly agentInvocation: AgentInvocationService,
    private readonly agentRegistry: AgentRegistry,
    private readonly reportAssembly: ReportAssemblyService,
  ) {
    super();
  }

  async process(job: Job<RunTaskJobData>): Promise<void> {
    const task = await this.taskModel.findById(job.data.taskId);
    if (!task) {
      // The Task row is gone by the time the worker picked this job up —
      // nothing left to do or report on.
      return;
    }

    if (task.status === 'PENDING') {
      // Guards the race with POST /tasks/:id/cancel: if the Task was
      // cancelled before the worker got to it, canTransitionTo('RUNNING') is
      // false (CANCELLED has no outgoing transitions) and this just skips it
      // silently, rather than resurrecting a cancelled Task into RUNNING.
      if (!task.canTransitionTo('RUNNING')) {
        return;
      }
      task.status = 'RUNNING';
      await task.save();
      this.events.emitTaskUpdated(task.userId, task.id, 'RUNNING');
    } else if (task.status !== 'RUNNING') {
      // Terminal already (COMPLETED/FAILED/CANCELLED) — a stale job racing a
      // cancel, or a duplicate BullMQ delivery. Nothing left to do. A
      // RUNNING Task falls through: either the block above just ran in this
      // same call, or this is a BE-17 continuation (sprintId just answered,
      // or a resume-task job) landing on a Task that was already RUNNING
      // before this job was enqueued.
      return;
    }

    // BE-18: machine time for *this* call only, added to whatever earlier
    // segments already accumulated — never reset, since a paused-then-
    // resumed Task reaches here more than once. Wraps the SPRINT_ID
    // pre-check too (startOrPause can return INTERRUPTED without ever
    // calling the agent); that's still machine time, just a very small
    // amount of it.
    const startedAt = Date.now();
    try {
      const result = isResumeJob(job.data)
        ? await this.agentInvocation.resume(task, job.data.inputValue)
        : await this.startOrPause(task);
      task.accumulatedMs += Date.now() - startedAt;
      await this.applyResult(task, result);
    } catch (err) {
      task.accumulatedMs += Date.now() - startedAt;
      await this.finishFailed(task, {
        code: 'UPSTREAM',
        message: err instanceof Error ? err.message : 'Unknown error',
        stage: 'EXECUTION',
      });
    }

    await this.maybeEmitBatchCompleted(task.batchId, task.userId);
  }

  // BE-17: the Changelog agents need a Sprint ID that's never known at
  // context-creation time — collected interactively, the first time a
  // Changelog Task actually reaches the front of the queue, rather than
  // blocking POST /tasks itself on it. A plain {taskId} job reaches this
  // twice for the same Task when that happens: once to discover sprintId is
  // missing and pause, again after POST /tasks/:id/input has set it — the
  // second time, task.status is already RUNNING so process() skips straight
  // past the PENDING block above to here, and this time the check falls
  // through to invoke().
  private async startOrPause(
    task: TaskDocument,
  ): Promise<AgentInvocationResult> {
    const needsSprintId =
      this.agentRegistry.getAgent(task.operation) === 'CHANGELOG' &&
      task.sprintId == null;

    if (needsSprintId) {
      return { status: 'INTERRUPTED', pendingInput: { kind: 'SPRINT_ID' } };
    }
    return this.agentInvocation.invoke(task);
  }

  private async applyResult(
    task: TaskDocument,
    result: AgentInvocationResult,
  ): Promise<void> {
    if (result.status === 'INTERRUPTED') {
      task.pendingInput = result.pendingInput;
      await task.save();
      this.events.emitTaskInputRequired(
        task.userId,
        task.id,
        result.pendingInput,
      );
      return;
    }

    if (result.status === 'FAILED') {
      // The type says `error` is always populated (AgentInvocationService's
      // own failure() always builds one) — this fallback is for whatever a
      // caller passes at runtime regardless of what the type promises, same
      // as before BE-18 touched this method.
      const error = result.error ?? {
        code: 'UPSTREAM',
        message: 'Agent invocation failed with no further detail',
        stage: 'EXECUTION',
      };
      await this.finishFailed(task, error);
      return;
    }

    await this.finishCompleted(task, result.payload);
  }

  // BE-18: assembles and persists the Report, then lets the frontend reach
  // it the same way it already reaches everything else about a Task — via
  // TaskDto.reportId (GET /tasks/:id) and the reportId this same event now
  // carries, instead of a bare status flip with nothing behind it.
  private async finishCompleted(
    task: TaskDocument,
    payload: AgentRunPayload,
  ): Promise<void> {
    const report = await this.reportAssembly.assembleCompleted(task, payload);
    task.reportId = report._id;
    task.status = 'COMPLETED';
    await task.save();
    this.events.emitTaskUpdated(
      task.userId,
      task.id,
      'COMPLETED',
      task.reportId.toString(),
    );
  }

  // Shared by applyResult's FAILED branch and process()'s catch block — a
  // Task that never reaches the agent at all (e.g. resume() throwing on a
  // missing lgThreadId) still needs a Report to point users at, same as one
  // the agent itself reported failing: "con successo o meno" (BE-18) covers
  // both.
  private async finishFailed(
    task: TaskDocument,
    error: TaskError,
  ): Promise<void> {
    const report = await this.reportAssembly.assembleFailed(task, error);
    task.reportId = report._id;
    task.status = 'FAILED';
    task.error = error;
    await task.save();
    this.events.emitTaskFailed(task.userId, task.id, task.error);
  }

  // Whether every Task in this batch has reached a terminal state — checked
  // by querying rather than a maintained counter, since a batch is a small,
  // short-lived group and there's no separate Batch collection to keep a
  // counter on (batchId is a correlation label only, per Task's own schema
  // comment). A RUNNING Task paused on pendingInput still counts as active
  // here exactly as it did before BE-17 — this query was never
  // status-specific beyond PENDING/RUNNING — so a batch with a paused Task
  // correctly never reports completed until it's answered one way or
  // another.
  private async maybeEmitBatchCompleted(
    batchId: string,
    userId: string,
  ): Promise<void> {
    const stillActive = await this.taskModel.countDocuments({
      batchId,
      status: { $in: ['PENDING', 'RUNNING'] },
    });
    if (stillActive > 0) {
      return;
    }

    const [completed, failed] = await Promise.all([
      this.taskModel.countDocuments({ batchId, status: 'COMPLETED' }),
      this.taskModel.countDocuments({
        batchId,
        status: { $in: ['FAILED', 'CANCELLED'] },
      }),
    ]);
    this.events.emitBatchCompleted(userId, batchId, completed, failed);
  }
}
