import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Job } from 'bullmq';
import { Task, TaskDocument } from './schemas/task.schema';
import { AgentInvocationService } from './agent-invocation.service';
import { EventsGateway } from '../events/events.gateway';

export interface RunTaskJobData {
  taskId: string;
}

// The queue consumer (PoC's TaskProcessor, fig. 7/8). One job per Task,
// picked up independently — RF.48's "a failing job doesn't drag down the
// others" is BullMQ's normal per-job isolation, as long as this class never
// lets an error escape process() uncaught, which is why the agent
// invocation is wrapped in try/catch below rather than left to propagate.
@Processor('tasks')
export class TaskProcessor extends WorkerHost {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    private readonly events: EventsGateway,
    private readonly agentInvocation: AgentInvocationService,
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

    try {
      const result = await this.agentInvocation.invoke(task);

      if (result.status === 'FAILED') {
        task.status = 'FAILED';
        task.error = result.error ?? {
          code: 'UPSTREAM',
          message: 'Agent invocation failed with no further detail',
          stage: 'EXECUTION',
        };
        await task.save();
        this.events.emitTaskFailed(task.userId, task.id, task.error);
      } else {
        task.status = result.status;
        await task.save();
        this.events.emitTaskUpdated(
          task.userId,
          task.id,
          result.status,
          task.reportId?.toString(),
        );
      }
    } catch (err) {
      task.status = 'FAILED';
      task.error = {
        code: 'UPSTREAM',
        message: err instanceof Error ? err.message : 'Unknown error',
        stage: 'EXECUTION',
      };
      await task.save();
      this.events.emitTaskFailed(task.userId, task.id, task.error);
    }

    await this.maybeEmitBatchCompleted(task.batchId, task.userId);
  }

  // Whether every Task in this batch has reached a terminal state — checked
  // by querying rather than a maintained counter, since a batch is a small,
  // short-lived group and there's no separate Batch collection to keep a
  // counter on (batchId is a correlation label only, per Task's own schema
  // comment).
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
