import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalAuthGuard } from '../common/guards/internal-auth.guard';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { TaskProgressCallbackDto } from './dto/task-progress-callback.dto';
import { EventsGateway } from './events.gateway';

// Called by the agent service mid-execution. This is the only one of the
// five realtime signals that crosses the network from outside this
// process — task.updated / task.failed / batch.completed /
// task.inputRequired are all raised in-process, directly on EventsGateway,
// by whatever backend code (future BE-13/BE-15/BE-17) changes a Task's
// state, with no HTTP hop needed.
@ApiExcludeController()
@Controller('internal/tasks')
@UseGuards(InternalAuthGuard)
export class InternalTaskProgressController {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    private readonly events: EventsGateway,
  ) {}

  @Post(':id/progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  async progress(
    @Param('id') id: string,
    @Body() dto: TaskProgressCallbackDto,
  ): Promise<void> {
    // The pre-update document is enough: userId never changes, and we only
    // need it to know which room to emit to.
    const task = await this.taskModel.findByIdAndUpdate(id, {
      progressPercent: dto.percent,
      currentStage: dto.stage,
    });
    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }

    this.events.emitTaskProgress(task.userId, id, dto.stage, dto.percent);
  }
}
