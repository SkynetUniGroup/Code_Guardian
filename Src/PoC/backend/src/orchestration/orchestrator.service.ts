import { Injectable } from '@nestjs/common';
import { AgentRegistry, type AgentDescriptor } from './agent.registry.js';
import type { OperationCode } from '../common/dto/types.js';

@Injectable()
export class OrchestratorService {
  constructor(private readonly registry: AgentRegistry) {}

  resolve(code: OperationCode): AgentDescriptor {
    // Implementazione del vincolo RV.1: instradamento deterministico
    // Nessun LLM coinvolto nello smistamento, usa la mappa statica.
    return this.registry.getByOperationCode(code);
  }
}