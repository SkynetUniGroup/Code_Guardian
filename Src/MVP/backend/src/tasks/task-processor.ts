import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
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

// How long a processing claim stays valid before another delivery may take
// it over. Deliberately far above any legitimate in-flight invocation: an
// operation's agent budget is capped at 300s (RQ.6) and
// AgentInvocationService aborts its own HTTP call at that ceiling plus its
// margin, so nothing legitimate can still be running after this. A claim
// this old means the worker holding it died — killed mid-invocation,
// container restarted — without ever reaching the release below, and the
// Task would otherwise be unprocessable forever.
const CLAIM_LEASE_MS = 10 * 60 * 1000;

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
//
// Every read-then-write in here is a conditional write (claim(),
// markRunning(), persistIfStillRunning()) rather than the mutate-then-
// save() this class used to do. Two different races made that necessary:
// a duplicate BullMQ delivery reading the same Task before the first
// delivery finished (both would invoke the agent), and a cancel landing
// mid-invocation only to be overwritten by the completing run (save()
// writes the paths touched in memory without looking at what the database
// says now). Both are gone if — and only if — the guard lives in the query
// filter, where the database can enforce it, instead of in an `if` over a
// value read moments earlier.
@Processor('tasks')
export class TaskProcessor extends WorkerHost {
  private readonly logger = new Logger(TaskProcessor.name);

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
    const task = await this.claim(job.data.taskId);
    if (!task) {
      // Gone, already claimed by a concurrent delivery, or in a terminal
      // state (a cancel that landed before the worker got here — CANCELLED,
      // COMPLETED and FAILED simply aren't in the claim filter). Nothing to
      // do or report on in any of those cases.
      return;
    }

    try {
      if (task.status === 'PENDING' && !(await this.markRunning(task))) {
        // Cancelled in the window between the claim and the transition.
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
    } finally {
      await this.releaseClaim(task);
    }
  }

  // Claiming and reading are one atomic operation on purpose: the filter is
  // what makes a second, concurrent delivery of the same job a no-op —
  // only one writer can move processingClaimedAt away from null-or-stale,
  // and the loser gets null back here and returns without touching the
  // agent. Reading first and checking afterwards cannot express that, which
  // is exactly how two deliveries used to both get past the RUNNING
  // fallthrough and invoke the agent twice.
  private async claim(taskId: string): Promise<TaskDocument | null> {
    // One clock read for both ends of the comparison: the threshold below
    // and the stamp written on success have to be the same "now", or a
    // claim could be judged stale against a moment it was never measured
    // from.
    const now = Date.now();
    const staleBefore = new Date(now - CLAIM_LEASE_MS);

    return this.taskModel.findOneAndUpdate(
      {
        _id: taskId,
        // The three ways a Task may legitimately be picked up: a fresh
        // PENDING one, a Changelog continuation whose sprintId was just
        // answered, and a resume — the last two both already RUNNING.
        // Terminal statuses are absent by construction, which is also what
        // makes a cancelled Task skip silently.
        status: { $in: ['PENDING', 'RUNNING'] },
        $or: [
          { processingClaimedAt: null },
          { processingClaimedAt: { $lte: staleBefore } },
        ],
      },
      { $set: { processingClaimedAt: new Date(now) } },
      { new: true },
    );
  }

  private async releaseClaim(task: TaskDocument): Promise<void> {
    try {
      await this.taskModel.updateOne(
        { _id: task._id },
        { $set: { processingClaimedAt: null } },
      );
    } catch (err) {
      // Never rethrow from the finally: the work itself may well have
      // succeeded, and failing the whole job over the release would undo
      // RF.48's isolation for no gain. A claim left behind here is taken
      // over again after CLAIM_LEASE_MS.
      this.logger.warn(
        `Could not release the processing claim on Task ${task.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // The PENDING → RUNNING transition, conditioned on the Task still being
  // PENDING rather than on the in-memory canTransitionTo() this used to
  // call. Same rule TRANSITIONS encodes (PENDING is the only status with
  // RUNNING as a legal next step), but expressed where it can actually be
  // enforced: as a filter, so a cancel landing between the claim and this
  // write wins instead of being overwritten by a $set computed from a read
  // taken moments earlier.
  //
  // Deliberately not mirrored onto the in-memory document. The caller keeps
  // using that document, and AgentInvocationService save()s it further down
  // to persist lgThreadId — a Mongoose save() flushes every path touched in
  // memory, so assigning status here would let that unrelated save write
  // RUNNING back over a cancel that landed in between, reintroducing the
  // very lost update the conditional writes in this class exist to prevent.
  private async markRunning(task: TaskDocument): Promise<boolean> {
    const { matchedCount } = await this.taskModel.updateOne(
      { _id: task._id, status: 'PENDING' },
      { $set: { status: 'RUNNING' } },
    );
    if (matchedCount === 0) {
      return false;
    }

    this.events.emitTaskUpdated(task.userId, task.id, 'RUNNING');
    return true;
  }

  // Every state change a finished (or paused) invocation wants to make goes
  // through here: a $set conditioned on the Task still being RUNNING,
  // instead of task.save(). save() writes whatever paths were touched in
  // memory without looking at what the database holds now, so a cancel that
  // landed while the agent was working was silently overwritten by the
  // completing invocation. False means someone else moved the Task — in
  // practice, cancelled it — and this invocation's result must be neither
  // applied nor announced.
  private async persistIfStillRunning(
    task: TaskDocument,
    changes: Record<string, unknown>,
  ): Promise<boolean> {
    const { matchedCount } = await this.taskModel.updateOne(
      { _id: task._id, status: 'RUNNING' },
      { $set: changes },
    );
    return matchedCount === 1;
  }

  // BE-17: the Changelog agents need a Sprint ID that's never known at
  // context-creation time — collected interactively, the first time a
  // Changelog Task actually reaches the front of the queue, rather than
  // blocking POST /tasks itself on it. A plain {taskId} job reaches this
  // twice for the same Task when that happens: once to discover sprintId is
  // missing and pause, again after POST /tasks/:id/input has set it — the
  // second time the Task is already RUNNING, so process() skips the PENDING
  // transition and comes straight here, and this time the check falls
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
      const persisted = await this.persistIfStillRunning(task, {
        pendingInput: result.pendingInput,
        accumulatedMs: task.accumulatedMs,
      });
      if (!persisted) {
        return;
      }
      task.pendingInput = result.pendingInput;
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
      // caller passes at runtime regardless of what the type promises.
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
  // TaskDto.reportId (GET /tasks/:id) and the reportId this same event
  // carries.
  private async finishCompleted(
    task: TaskDocument,
    payload: AgentRunPayload,
  ): Promise<void> {
    const report = await this.reportAssembly.assembleCompleted(task, payload);
    const persisted = await this.persistIfStillRunning(task, {
      status: 'COMPLETED',
      reportId: report._id,
      accumulatedMs: task.accumulatedMs,
    });
    if (!persisted) {
      // A cancel landed while the agent was still working. The Task stays
      // CANCELLED — no status flip back to COMPLETED, and no task.updated
      // contradicting the task.updated CANCELLED the frontend already got.
      // The Report is left where it is: the work really was done, and an
      // unreferenced Report row is cheaper (and more honest) than pretending
      // it wasn't.
      return;
    }

    task.reportId = report._id;
    task.status = 'COMPLETED';
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
    const persisted = await this.persistIfStillRunning(task, {
      status: 'FAILED',
      error,
      reportId: report._id,
      accumulatedMs: task.accumulatedMs,
    });
    if (!persisted) {
      // Same reasoning as finishCompleted: a cancel got here first and this
      // failure is no longer the Task's outcome to announce.
      return;
    }

    task.reportId = report._id;
    task.status = 'FAILED';
    task.error = error;
    this.events.emitTaskFailed(task.userId, task.id, error);
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
