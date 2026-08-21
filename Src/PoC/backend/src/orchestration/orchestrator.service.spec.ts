/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service.js';
import { AgentRegistry } from './agent.registry.js';
import type { OperationCode } from '../common/dto/types.js';

// TU_08 (PdQ) — RV.1: l'Orchestratore delega ogni risoluzione al registro statico
// degli agenti, senza alcuna chiamata a un modello LLM nel percorso di instradamento,
// e propaga (non inghiotte) l'eccezione per un codice operazione non mappato.
describe('OrchestratorService (Vincolo RV.1: instradamento deterministico)', () => {
  let service: OrchestratorService;
  let mockRegistry: { getByOperationCode: jest.Mock };

  beforeEach(async () => {
    mockRegistry = {
      getByOperationCode: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrchestratorService,
        { provide: AgentRegistry, useValue: mockRegistry },
      ],
    }).compile();

    service = module.get<OrchestratorService>(OrchestratorService);
  });

  it('dovrebbe essere definito', () => {
    expect(service).toBeDefined();
  });

  it('dovrebbe delegare la risoluzione al registro statico, senza logica LLM nel percorso', () => {
    // Setup: il registro restituisce un descrittore fittizio
    const fakeDescriptor = { agentId: 'security', operation: 'SECURITY_OWASP', destinationUrl: '/agents/security/run' };
    mockRegistry.getByOperationCode.mockReturnValue(fakeDescriptor);

    // Act
    const result = service.resolve('SECURITY_OWASP');

    // Assert: il servizio e' un puro pass-through deterministico sul registro
    expect(mockRegistry.getByOperationCode).toHaveBeenCalledWith('SECURITY_OWASP');
    expect(mockRegistry.getByOperationCode).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeDescriptor);
  });

  it('dovrebbe propagare la NotFoundException sollevata dal registro per una operazione non mappata', () => {
    // Setup: il registro reale lancia NotFoundException per codici sconosciuti
    mockRegistry.getByOperationCode.mockImplementation(() => {
      throw new NotFoundException('Operazione non supportata: INVALID_CODE');
    });

    // Act & Assert: l'orchestratore non deve "inghiottire" l'eccezione, ma lasciarla risalire
    expect(() => service.resolve('INVALID_CODE' as OperationCode)).toThrow(NotFoundException);
  });

  it('dovrebbe invocare il registro esattamente una volta per ciascuna chiamata a resolve()', () => {
    mockRegistry.getByOperationCode.mockReturnValue({
      agentId: 'docs', operation: 'DOCS_INLINE', destinationUrl: '/agents/docs/run',
    });

    service.resolve('DOCS_INLINE');
    service.resolve('DOCS_INLINE');

    // Nessuna cache/side-effect nascosto: ogni resolve() e' una chiamata indipendente
    expect(mockRegistry.getByOperationCode).toHaveBeenCalledTimes(2);
  });
});
