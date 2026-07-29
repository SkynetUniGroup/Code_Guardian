import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, UseGuards, NotFoundException, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, type TaskDocument } from '../domain/schemas/task.schema.js';
import { CreateTaskBatchDto } from '../common/dto/task.dto.js';
import { TaskQueueService } from '../orchestration/task-queue.service.js';
import { OrchestratorService } from '../orchestration/orchestrator.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { EventsGateway } from './events.gateway.js';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard) 
@Controller() 
export class TaskController {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    private readonly queueService: TaskQueueService,
    private readonly orchestrator: OrchestratorService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  @Get('operations')
  getOperations() {
    return [
      { code: 'DOCS_INLINE', name: 'Documentazione Inline' },
      { code: 'SECURITY_OWASP', name: 'Scansione OWASP' },
      { code: 'CHANGELOG_TECHNICAL', name: 'Changelog Tecnico' },
    ];
  }

  @Post('tasks')
  @HttpCode(HttpStatus.ACCEPTED)
  async createTasks(@Body() dto: CreateTaskBatchDto, @CurrentUser() userId: string) {
    for (const opCode of dto.operations) {
      this.orchestrator.resolve(opCode);
    }

    const taskIds: string[] = [];
    const batchId = new Types.ObjectId().toString();

    for (const opCode of dto.operations) {
      const task = new this.taskModel({
        userId: userId,
        batchId,
        contextId: dto.contextId,
        operation: opCode,
        status: 'PENDING',
      });
 
      const savedTask = await task.save();
      taskIds.push(savedTask._id.toString());
      await this.queueService.enqueue(savedTask);
    }

    return { taskIds, batchId };
  }


  @Get('tasks')
  async getTasks(@CurrentUser() userId: string) {
    // Restituisce tutte le task dell'utente ordinate dalla più recente
    return this.taskModel.find({ userId }).sort({ createdAt: -1 }).lean().exec();
  }

  @Get('tasks/:id')
  async getTask(@Param('id') id: string, @CurrentUser() userId: string) {
    const task = await this.taskModel.findOne({ _id: id, userId }).lean().exec();
    if (!task) {
      throw new NotFoundException('Task non trovata');
    }
    return task;
  }

  @Post('tasks/:id/cancel')
@HttpCode(HttpStatus.NO_CONTENT)
async cancelTask(@Param('id') id: string, @CurrentUser() userId: string) {
  const task = await this.taskModel.findOne({ _id: id, userId }).exec();
  if (!task) {
    throw new NotFoundException('Task non trovata');
  }
  if (!task.canTransitionTo('CANCELLED')) {
    throw new BadRequestException(`Impossibile annullare una task nello stato ${task.status}`);
  }
  task.status = 'CANCELLED';
  await task.save();
  this.eventsGateway.emitTaskUpdated(id, 'CANCELLED', undefined, userId);
  return;
}
}