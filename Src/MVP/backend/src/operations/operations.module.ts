import { Module } from '@nestjs/common';
import { AgentRegistry } from './agent-registry.service';
import { OperationsController } from './operations.controller';

@Module({
  controllers: [OperationsController],
  providers: [AgentRegistry],
  exports: [AgentRegistry],
})
export class OperationsModule {}
