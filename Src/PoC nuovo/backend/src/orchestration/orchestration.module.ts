import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { AgentRegistry } from './agent.registry.js';
import { AgentGatewayService } from './agent-gateway.service.js';
import { TaskQueueService } from './task-queue.service.js';
import { TaskProcessor } from './task.processor.js';
import { OrchestratorService } from './orchestrator.service.js';
import { DomainModule } from '../domain/domain.module.js';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    DomainModule,
    HttpModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          url: configService.get<string>('REDIS_URL'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'tasks',
    }),
  ],
  providers: [
    AgentRegistry,
    AgentGatewayService,
    TaskQueueService,
    TaskProcessor,
    OrchestratorService
  ],
  exports: [TaskQueueService, OrchestratorService], 
})
export class OrchestrationModule {}