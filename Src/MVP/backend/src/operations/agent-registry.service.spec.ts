import { vi } from 'vitest';
import {
  AgentRegistry,
  MAX_OPERATION_TIMEOUT_S,
} from './agent-registry.service';
import { OperationCode, OPERATION_CODES } from '../common/domain-types';
import { AgentName, AgentRegistryEntry } from './agent-registry.types';
import { UserRole } from '../auth/schemas/user.schema';

function codesOf(descriptors: { code: OperationCode }[]): OperationCode[] {
  return descriptors.map((d) => d.code).sort();
}

describe('AgentRegistry', () => {
  const registry = new AgentRegistry();

  it('gives DEVELOPER exactly the Docs operations plus the shared changelog one', () => {
    expect(codesOf(registry.getForRole('DEVELOPER'))).toEqual(
      ['CHANGELOG_TECHNICAL', 'DOCS_API', 'DOCS_INLINE', 'DOCS_README'].sort(),
    );
  });

  it('gives SECURITY_AUDITOR exactly the two Security operations', () => {
    expect(codesOf(registry.getForRole('SECURITY_AUDITOR'))).toEqual(
      ['SECURITY_OWASP', 'SECURITY_POLICY'].sort(),
    );
  });

  it('gives PROJECT_MANAGER both changelog operations and nothing else', () => {
    expect(codesOf(registry.getForRole('PROJECT_MANAGER'))).toEqual(
      ['CHANGELOG_BUSINESS', 'CHANGELOG_TECHNICAL'].sort(),
    );
  });

  it('never leaks allowedRoles into the returned descriptors', () => {
    const [first] = registry.getForRole('DEVELOPER');
    expect(first).not.toHaveProperty('allowedRoles');
    expect(Object.keys(first).sort()).toEqual(
      ['agent', 'code', 'description', 'displayName'].sort(),
    );
  });

  it('returns the configured timeout for a known operation', () => {
    expect(registry.getTimeoutS('DOCS_INLINE')).toBe(90);
  });

  describe('the 300s hard ceiling (RQ.6, BE-15)', () => {
    // The spy below has to come off even when the test that installs it
    // fails. Restoring at the end of the test body only runs on the happy
    // path, so a genuine failure of the ceiling test used to leave `entry`
    // mocked for every test after it in this file — four unrelated ones went
    // red alongside it, and the one that meant something was hard to find.
    // There is no `restoreMocks` in the Jest config, so it belongs here.
    afterEach(() => {
      vi.restoreAllMocks();
    });
    it('never returns more than the ceiling, even for a registry entry above it', () => {
      // The shipped table tops out at 180s, so nothing in it can demonstrate
      // the ceiling — a test written only against the real entries would
      // pass just as happily with no clamp at all. This substitutes a single
      // over-budget entry, which is exactly the change someone editing
      // ENTRIES could make, and asserts the ceiling holds anyway.
      const overBudget: AgentRegistryEntry = {
        code: 'DOCS_README',
        displayName: 'README generation/update',
        description: 'irrelevant here',
        agent: 'DOCS',
        allowedRoles: ['DEVELOPER'],
        timeoutS: 900,
      };
      vi.spyOn(
          registry as unknown as {
            entry: (code: OperationCode) => AgentRegistryEntry;
          },
          'entry',
        )
        .mockReturnValue(overBudget);

      expect(registry.getTimeoutS('DOCS_README')).toBe(300);
      expect(registry.getTimeoutS('DOCS_README')).toBe(MAX_OPERATION_TIMEOUT_S);
    });

    it('leaves an entry below the ceiling exactly as configured', () => {
      // The clamp is a ceiling, not a normalization: nothing legitimate
      // moves because of it.
      expect(registry.getTimeoutS('SECURITY_OWASP')).toBe(180);
      expect(registry.getTimeoutS('CHANGELOG_TECHNICAL')).toBe(90);
    });

    it('keeps every shipped entry under the ceiling', () => {
      // If this ever fails, the clamp above is silently shortening a real
      // operation's budget rather than merely standing guard — worth
      // noticing rather than absorbing.
      const codes: OperationCode[] = [
        'DOCS_README',
        'DOCS_INLINE',
        'DOCS_API',
        'SECURITY_OWASP',
        'SECURITY_POLICY',
        'CHANGELOG_TECHNICAL',
        'CHANGELOG_BUSINESS',
      ];
      for (const code of codes) {
        expect(registry.getTimeoutS(code)).toBeLessThanOrEqual(
          MAX_OPERATION_TIMEOUT_S,
        );
      }
    });
  });

  it('throws for an unknown operation code', () => {
    expect(() => registry.getTimeoutS('NOT_REAL' as never)).toThrow(
      'Unknown OperationCode',
    );
  });

  it('returns the agent that owns a known operation', () => {
    expect(registry.getAgent('CHANGELOG_BUSINESS')).toBe('CHANGELOG');
    expect(registry.getAgent('DOCS_README')).toBe('DOCS');
    expect(registry.getAgent('SECURITY_OWASP')).toBe('SECURITY');
  });

  it('throws for an unknown operation code when looking up the owning agent', () => {
    expect(() => registry.getAgent('NOT_REAL' as never)).toThrow(
      'Unknown OperationCode',
    );
  });

  it('returns the human-readable display name for a known operation', () => {
    expect(registry.getDisplayName('DOCS_README')).toBe(
      'README generation/update',
    );
  });

  it('throws for an unknown operation code when looking up the display name', () => {
    expect(() => registry.getDisplayName('NOT_REAL' as never)).toThrow(
      'Unknown OperationCode',
    );
  });
});

/**
 * TU_18 (RF.40, RV.1) — il registro risolve il descrittore per ciascuno dei
 * sette OperationCode.
 *
 * Estende TU_08, che si ferma al fatto che l'instradamento passi dal registro
 * statico: qui la copertura passa dai tre codici verificati oggi a tutti e
 * sette, e la lista dei sette non è riscritta a mano ma è OPERATION_CODES,
 * cioè la stessa costante che valida CreateTaskBatchDto. Aggiungere
 * un'ottava operazione al dominio senza darle una voce nel registro rende
 * rosso questo blocco invece di produrre un "Unknown OperationCode" al primo
 * avvio in produzione.
 *
 * Corrispondenza PARZIALE rispetto alla formulazione del Piano di Qualifica,
 * che chiede il descrittore come coppia (agentId, destinationUrl): nell'MVP
 * `destinationUrl` non esiste. Il registro porta `agent` (DOCS, SECURITY,
 * CHANGELOG) — l'equivalente di agentId — mentre la destinazione è una sola
 * per tutte e sette le operazioni, l'AGENTS_SERVICE_URL letto da
 * AgentInvocationService, perché il servizio agenti è un unico processo
 * FastAPI che smista internamente su operationCode
 * (agents/src/main.py, get_agent_components). La parte di destinazione è
 * verificata dov'è: agent-invocation.service.spec.ts, stesso codice TU_18.
 */
describe('TU_18 (RF.40, RV.1) — descrittore risolto per tutti e sette gli OperationCode', () => {
  const registry = new AgentRegistry();

  // L'agente che possiede ciascuna operazione, e il budget di esecuzione
  // della Tabella 45. Restati qui perché il test confronti il registro con la
  // progettazione, non con se stesso.
  const ATTESI: Record<OperationCode, { agent: AgentName; timeoutS: number }> = {
    DOCS_README: { agent: 'DOCS', timeoutS: 150 },
    DOCS_INLINE: { agent: 'DOCS', timeoutS: 90 },
    DOCS_API: { agent: 'DOCS', timeoutS: 150 },
    SECURITY_OWASP: { agent: 'SECURITY', timeoutS: 180 },
    SECURITY_POLICY: { agent: 'SECURITY', timeoutS: 120 },
    CHANGELOG_TECHNICAL: { agent: 'CHANGELOG', timeoutS: 90 },
    CHANGELOG_BUSINESS: { agent: 'CHANGELOG', timeoutS: 120 },
  };

  const RUOLI: UserRole[] = ['DEVELOPER', 'SECURITY_AUDITOR', 'PROJECT_MANAGER'];

  it('il dominio conta esattamente sette operazioni', () => {
    // Il presupposto di tutto il blocco: se OPERATION_CODES ne contenesse sei,
    // le asserzioni "per ciascuno dei sette" gireranno su sei senza dirlo.
    expect(OPERATION_CODES).toHaveLength(7);
    expect([...OPERATION_CODES].sort()).toEqual(Object.keys(ATTESI).sort());
  });

  it.each(OPERATION_CODES)(
    '%s risolve sull\'agente e sul budget previsti',
    (code) => {
      expect({
        agent: registry.getAgent(code),
        timeoutS: registry.getTimeoutS(code),
      }).toEqual(ATTESI[code]);
    },
  );

  it.each(OPERATION_CODES)('%s ha un nome visualizzabile non vuoto', (code) => {
    expect(registry.getDisplayName(code).trim().length).toBeGreaterThan(0);
  });

  it('i sette nomi visualizzabili sono distinti', () => {
    // Il titolo del Report è "<displayName> — owner/repo@branch" (RF.51): due
    // operazioni con lo stesso nome darebbero due Report indistinguibili
    // nello storico.
    const nomi = OPERATION_CODES.map((code) => registry.getDisplayName(code));
    expect(new Set(nomi).size).toBe(OPERATION_CODES.length);
  });

  it('ogni operazione è avviabile da almeno un ruolo, e i tre ruoli insieme le coprono tutte', () => {
    // Una voce nel registro che nessun ruolo può selezionare sarebbe
    // un'operazione esistente e irraggiungibile.
    const raggiungibili = new Set(
      RUOLI.flatMap((ruolo) =>
        registry.getForRole(ruolo).map((descrittore) => descrittore.code),
      ),
    );
    expect([...raggiungibili].sort()).toEqual([...OPERATION_CODES].sort());
  });

  it.each(OPERATION_CODES)(
    '%s compare nel catalogo del ruolo con lo stesso agente che il registro le assegna',
    (code) => {
      // getForRole e getAgent non devono poter divergere: il descrittore che
      // l'utente vede e quello su cui l'Orchestratore instrada sono lo stesso.
      const descrittori = RUOLI.flatMap((ruolo) => registry.getForRole(ruolo))
        .filter((descrittore) => descrittore.code === code);
      expect(descrittori.length).toBeGreaterThan(0);
      for (const descrittore of descrittori) {
        expect(descrittore.agent).toBe(registry.getAgent(code));
        expect(descrittore.displayName).toBe(registry.getDisplayName(code));
      }
    },
  );

  it('RV.1 — la risoluzione non consulta nulla fuori dalla tabella statica', () => {
    // Due prove strutturali, non un mock di comodo: la classe non ha
    // dipendenze iniettate (quindi non ha un provider LLM da chiamare) e la
    // risoluzione dei sette codici non tocca la rete.
    expect(AgentRegistry.length).toBe(0);

    const rete = vi.fn();
    const originale = global.fetch;
    global.fetch = rete as never;
    try {
      for (const code of OPERATION_CODES) {
        registry.getAgent(code);
        registry.getTimeoutS(code);
        registry.getDisplayName(code);
      }
      for (const ruolo of RUOLI) {
        registry.getForRole(ruolo);
      }
    } finally {
      global.fetch = originale;
    }
    expect(rete).not.toHaveBeenCalled();
  });

  it('RF.40 — la risoluzione è deterministica: due richieste uguali, stessa risposta', () => {
    for (const code of OPERATION_CODES) {
      expect(registry.getAgent(code)).toBe(registry.getAgent(code));
      expect(registry.getTimeoutS(code)).toBe(registry.getTimeoutS(code));
    }
  });

  it('un codice fuori catalogo non risolve su un agente di ripiego', () => {
    // L'alternativa silenziosa sarebbe instradare su un agente qualsiasi:
    // l'errore deve restare tale fino al chiamante.
    expect(() => registry.getAgent('DOCS_CHANGELOG' as never)).toThrow(
      'Unknown OperationCode',
    );
  });
});
