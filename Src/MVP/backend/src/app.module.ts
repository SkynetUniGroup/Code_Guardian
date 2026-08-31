import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { CredentialsModule } from './credentials/credentials.module';
import { GithubModule } from './github/github.module';
import { InternalGithubModule } from './github/internal-github.module';
import { ContextsModule } from './contexts/contexts.module';
import { TasksModule } from './tasks/tasks.module';
import { ReportsModule } from './reports/reports.module';
import { OperationsModule } from './operations/operations.module';
import { EventsModule } from './events/events.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    CredentialsModule,
    GithubModule,
    InternalGithubModule,
    ContextsModule,
    TasksModule,
    ReportsModule,
    OperationsModule,
    EventsModule,
  ],
})
export class AppModule {}
