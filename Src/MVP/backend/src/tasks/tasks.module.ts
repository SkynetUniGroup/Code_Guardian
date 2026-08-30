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
  // Re-exports the forFeature registration so other modules (BE-8's internal
  // GitHub facade needs to look up a Task by id) can inject Model<Task>
  // without this module having to expose a service of its own yet.
  exports: [MongooseModule],
})
export class TasksModule {}
