import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Task, TaskSchema } from './schemas/task.schema';
import {
  UsageCounter,
  UsageCounterSchema,
} from './schemas/usage-counter.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: UsageCounter.name, schema: UsageCounterSchema },
    ]),
  ],
})
export class TasksModule {}
