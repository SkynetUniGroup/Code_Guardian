import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { EventsGateway } from './events.gateway';
import { InternalTaskProgressController } from './internal-task-progress.controller';

// AuthModule: re-exported JwtModule, so the gateway verifies handshake
// tokens with the exact same secret/config as the REST side.
//
// The Task schema is registered directly here, rather than importing all of
// TasksModule for it: TasksModule (BE-13) needs EventsGateway itself, to
// emit events as it processes the queue, so importing TasksModule here would
// make the two modules circularly dependent. Registering the same schema in
// two modules' MongooseModule.forFeature is the standard, supported way to
// give both direct model access without one depending on the other —
// they resolve to the same underlying collection either way.
//
// EventsGateway is exported so BE-13's TaskProcessor, BE-15's agent
// invocation gateway, and BE-17's pause/resume can all inject it directly
// and call its emit* methods in-process once they land.
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: Task.name, schema: TaskSchema }]),
  ],
  controllers: [InternalTaskProgressController],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
