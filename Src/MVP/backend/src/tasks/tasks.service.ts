import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model, Types } from 'mongoose';
import { Queue } from 'bullmq';
import { Task, TaskDocument } from './schemas/task.schema';
import {
  AnalysisContext,
  AnalysisContextDocument,
} from '../contexts/schemas/analysis-context.schema';
import { CredentialsService } from '../credentials/credentials.service';
import { AgentRegistry } from '../operations/agent-registry.service';
import { EventsGateway } from '../events/events.gateway';
import { UsageLimitService } from './usage-limit.service';
import { AuthenticatedUser } from '../common/authenticated-user';
import { CreateTaskBatchDto } from './dto/create-task-batch.dto';
import { TaskDto, toTaskDto } from './dto/task.dto';
import { RunTaskJobData } from './task-processor';

export interface CreateTaskBatchResult {
  taskIds: string[];
  batchId: string;
}

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(AnalysisContext.name)
    private readonly contextModel: Model<AnalysisContextDocument>,
    private readonly credentials: CredentialsService,
    private readonly agentRegistry: AgentRegistry,
    private readonly events: EventsGateway,
    private readonly usageLimit: UsageLimitService,
    @InjectQueue('tasks') private readonly queue: Queue<RunTaskJobData>,
  ) {}

  // Four pre-accept checks: whole batch rejected on the first failure,
  // nothing partially queued. Order goes cheapest/local first, database
  // reads next, and the usage-limit check (RF.66, BE-14) last — it's the
  // only one that writes (and might have to roll its own write back), so it
  // only runs once everything else about the request is already known
  // valid, rather than spending quota on a request that would've failed
  // anyway.
  async createBatch(
    user: AuthenticatedUser,
    dto: CreateTaskBatchDto,
  ): Promise<CreateTaskBatchResult> {
    const operations = [...new Set(dto.operations)];
    if (operations.length === 0) {
      throw new BadRequestException(
        'operations must contain at least one operation code',
      );
    }

    const context = await this.contextModel.findOne({
      _id: dto.contextId,
      userId: user.userId,
    });
    if (!context) {
      throw new NotFoundException(`Context ${dto.contextId} not found`);
    }

    const hasCredential = await this.credentials.hasCredential(
      user.userId,
      'GITHUB',
    );
    if (!hasCredential) {
      throw new NotFoundException('No GITHUB credential configured');
    }

    const allowed = new Set(
      this.agentRegistry.getForRole(user.role).map((entry) => entry.code),
    );
    const disallowed = operations.filter((op) => !allowed.has(op));
    if (disallowed.length > 0) {
      throw new ForbiddenException(
        `Operation(s) not permitted for role ${user.role}: ${disallowed.join(', ')}`,
      );
    }

    await this.usageLimit.checkAndIncrement(user.userId, operations.length);

    const batchId = new Types.ObjectId().toString();
    const tasks = await this.taskModel.insertMany(
      operations.map((operation) => ({
        userId: user.userId,
        batchId,
        contextId: context._id,
        operation,
        status: 'PENDING',
      })),
    );

    await this.queue.addBulk(
      tasks.map((task) => ({
        name: 'run-task',
        data: { taskId: task.id },
      })),
    );

    return { taskIds: tasks.map((task) => task.id), batchId };
  }

  async findAllForUser(userId: string): Promise<TaskDto[]> {
    const tasks = await this.taskModel.find({ userId }).sort({ createdAt: -1 });
    return tasks.map(toTaskDto);
  }

  async findOneForUser(userId: string, id: string): Promise<TaskDto> {
    const task = await this.taskModel.findOne({ _id: id, userId });
    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }
    return toTaskDto(task);
  }

  // No attempt to pull an already-enqueued job back out of the queue: if the
  // worker picks it up after this runs, TaskProcessor's own
  // canTransitionTo('RUNNING') guard sees CANCELLED (a terminal state, no
  // outgoing transitions) and skips it silently. That guard already has to
  // exist for the race to be handled correctly, so a second removal path
  // here would be redundant, not safer.
  async cancel(userId: string, id: string): Promise<void> {
    const task = await this.taskModel.findOne({ _id: id, userId });
    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }
    if (!task.canTransitionTo('CANCELLED')) {
      throw new ConflictException(
        `Task ${id} cannot be cancelled from status ${task.status}`,
      );
    }

    task.status = 'CANCELLED';
    await task.save();
    this.events.emitTaskUpdated(userId, id, 'CANCELLED');
  }
}
