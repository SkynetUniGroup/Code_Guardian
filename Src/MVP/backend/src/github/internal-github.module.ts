import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GithubModule } from './github.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { TasksModule } from '../tasks/tasks.module';
import { ContextsModule } from '../contexts/contexts.module';
import { InternalGithubController } from './internal-github.controller';
import { InternalTaskContextResolver } from './internal-task-context.resolver';
import { AccessLog, AccessLogSchema } from './schemas/access-log.schema';

// Deliberately its own module rather than folded into GithubModule:
// CredentialsModule already imports GithubModule (for BE-6's live token
// check), and this facade needs CredentialsModule too (to decrypt a task
// owner's token) — importing CredentialsModule from inside GithubModule
// itself would make that a circular dependency. Sitting one layer above
// both avoids it entirely, no forwardRef() needed.
@Module({
  imports: [
    GithubModule,
    CredentialsModule,
    TasksModule,
    ContextsModule,
    MongooseModule.forFeature([
      { name: AccessLog.name, schema: AccessLogSchema },
    ]),
  ],
  controllers: [InternalGithubController],
  providers: [InternalTaskContextResolver],
})
export class InternalGithubModule {}
