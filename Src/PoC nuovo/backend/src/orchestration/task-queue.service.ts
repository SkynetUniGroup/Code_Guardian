import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { TaskDocument } from '../domain/schemas/task.schema.js';

@Injectable()
export class TaskQueueService {
  constructor(@InjectQueue('tasks') private readonly tasksQueue: Queue) {}

  // L'accodamento ritorna immediatamente per non bloccare il ciclo HTTP (ADR-3)
  async enqueue(task: TaskDocument): Promise<void> {
    await this.tasksQueue.add('execute-agent', {
      taskId: task._id.toString(),
    });
  }
}