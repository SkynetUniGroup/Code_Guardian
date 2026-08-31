import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { EventsGateway } from './events.gateway';
import { InternalTaskProgressController } from './internal-task-progress.controller';

// AuthModule: re-exported JwtModule, so the gateway verifies handshake
// tokens with the exact same secret/config as the REST side.
// TasksModule: re-exported MongooseModule, so the internal controller can
// look up a Task by id without a TasksService existing yet (BE-13).
//
// EventsGateway is exported so future issues (BE-13's TaskProcessor, BE-15's
// agent invocation gateway, BE-17's pause/resume) can inject it directly
// and call its emit* methods in-process once they land.
@Module({
  imports: [AuthModule, TasksModule],
  controllers: [InternalTaskProgressController],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
