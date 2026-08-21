/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { AgentRegistry } from './agent.registry.js';
import { NotFoundException } from '@nestjs/common';
import type { OperationCode } from '../common/dto/types.js';

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AgentRegistry],
    }).compile();

    registry = module.get<AgentRegistry>(AgentRegistry);
  });

  it('dovrebbe essere definito', () => {
    expect(registry).toBeDefined();
  });

  it('dovrebbe restituire il descrittore corretto per SECURITY_OWASP (Vincolo RV.1: Instradamento deterministico)', () => {
    // Act
    const descriptor = registry.getByOperationCode('SECURITY_OWASP');

    // Assert
    expect(descriptor).toBeDefined();
    expect(descriptor.agentId).toBe('security');
    expect(descriptor.destinationUrl).toBe('/agents/security/run');
  });

  it('dovrebbe lanciare NotFoundException per una OperationCode non mappata', () => {
    // Act & Assert
    expect(() => {
      registry.getByOperationCode('INVALID_CODE' as OperationCode);
    }).toThrow(NotFoundException);
  });
});