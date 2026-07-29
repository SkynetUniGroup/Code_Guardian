import { Injectable, NotFoundException } from '@nestjs/common';
import type { OperationCode } from '../common/dto/types.js';

export interface AgentDescriptor {
  agentId: string;
  operation: OperationCode;
  destinationUrl: string;
}

@Injectable()
export class AgentRegistry {
  // Mappa statica, popolata a bootstrap: nessun LLM coinvolto nell'instradamento (RV.1)
  private readonly registry = new Map<OperationCode, AgentDescriptor>([
    ['SECURITY_OWASP', { agentId: 'security', operation: 'SECURITY_OWASP', destinationUrl: '/agents/security/run' }],
    ['SECURITY_POLICY', { agentId: 'security', operation: 'SECURITY_POLICY', destinationUrl: '/agents/security/run' }],
    ['DOCS_INLINE', { agentId: 'docs', operation: 'DOCS_INLINE', destinationUrl: '/agents/docs/run' }],
    ['CHANGELOG_TECHNICAL', { agentId: 'changelog', operation: 'CHANGELOG_TECHNICAL', destinationUrl: '/agents/changelog/run' }],
  ]);

  getByOperationCode(code: OperationCode): AgentDescriptor {
    const descriptor = this.registry.get(code);
    if (!descriptor) {
      throw new NotFoundException(`Operazione non supportata: ${code}`);
    }
    return descriptor;
  }
}