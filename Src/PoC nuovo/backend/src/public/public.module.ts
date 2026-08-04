import { Module } from '@nestjs/common';
import { ContextController } from './context.controller';
import { TaskController } from './task.controller';
import { ReportController } from './report.controller';
import { CredentialsController } from './credentials.controller.js';
import { RepositoriesController } from './repositories.controller.js';
import { DomainModule } from '../domain/domain.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { AuthModule } from './auth/auth.module'; 
import { InternalModule } from '../internal/internal.module.js';

@Module({
  imports: [
    DomainModule, 
    InternalModule,
    OrchestrationModule,
    AuthModule 
  ],
  controllers: [
    ContextController, 
    TaskController, 
    ReportController,
    CredentialsController,
    RepositoriesController 
  ],
  providers: [],
})
export class PublicModule {}