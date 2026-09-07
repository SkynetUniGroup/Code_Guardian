import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mapAgentErrorKind } from './agent-error-mapping';

describe('mapAgentErrorKind', () => {
  it('passes through identical names', () => {
    expect(mapAgentErrorKind('TIMEOUT')).toBe('TIMEOUT');
    expect(mapAgentErrorKind('CONTEXT_TOO_LARGE')).toBe('CONTEXT_TOO_LARGE');
  });

  it('renames RATE_LIMITED to LLM_RATE_LIMITED', () => {
    expect(mapAgentErrorKind('RATE_LIMITED')).toBe('LLM_RATE_LIMITED');
  });

  it('falls back to UPSTREAM for unknown or missing values', () => {
    expect(mapAgentErrorKind('SOMETHING_NEW')).toBe('UPSTREAM');
    expect(mapAgentErrorKind(undefined)).toBe('UPSTREAM');
  });
});

/**
 * TU_26 (RF.65, RF.67-71, RQ.7, RQ.8) — corrispondenza biunivoca e completa
 * fra ErrorKind lato agente e error.code lato backend.
 *
 * I due lati del confine sono scritti in linguaggi diversi e nessun
 * compilatore li confronta: l'enumerazione sta in `agents/src/models.py`, il
 * dominio d'arrivo in `common/exceptions/error-kind.ts`, e in mezzo c'è una
 * tabella di stringhe. Ripetere qui le due liste a mano proverebbe solo che
 * questo file è coerente con se stesso, quindi entrambe vengono lette dai
 * sorgenti reali: aggiungere un valore all'enum Python, o toglierne uno
 * dall'unione TypeScript, rende rosso questo test invece di produrre in
 * silenzio un errore mappato su UPSTREAM.
 */
describe('TU_26 (RF.65, RF.67-71, RQ.7, RQ.8) — corrispondenza ErrorKind agente / error.code backend', () => {
  // Il catalogo degli otto valori come lo elenca il Piano di Qualifica, e il
  // codice che ciascuno deve assumere una volta attraversato il confine.
  const CORRISPONDENZA: Record<string, string> = {
    TIMEOUT: 'TIMEOUT',
    PARSING: 'PARSING',
    UPSTREAM: 'UPSTREAM',
    CONTEXT_TOO_LARGE: 'CONTEXT_TOO_LARGE',
    CONTEXT_RESOURCE_MISSING: 'CONTEXT_RESOURCE_MISSING',
    CONTEXT_RESOURCE_INVALID: 'CONTEXT_RESOURCE_INVALID',
    READABILITY_TOO_LOW: 'READABILITY_TOO_LOW',
    RATE_LIMITED: 'LLM_RATE_LIMITED',
  };

  const VALORI_AGENTE = Object.keys(CORRISPONDENZA);

  /** Legge un sorgente del monorepo a partire da questa cartella. */
  function sorgente(...segmenti: string[]): string {
    const percorso = resolve(__dirname, '..', '..', '..', ...segmenti);
    try {
      return readFileSync(percorso, 'utf8');
    } catch {
      throw new Error(
        `TU_26 non riesce a leggere ${percorso}. Il test confronta i due lati ` +
          'del confine sui sorgenti reali, quindi va eseguito sul monorepo ' +
          'completo, non su un checkout del solo backend.',
      );
    }
  }

  /** I membri di `class ErrorKind(str, Enum)` in agents/src/models.py. */
  function enumerazioneLatoAgente(): string[] {
    const modulo = sorgente('agents', 'src', 'models.py');
    const inizio = modulo.indexOf('class ErrorKind');
    expect(inizio).toBeGreaterThanOrEqual(0);
    // Fino alla dichiarazione successiva a livello di modulo: le righe del
    // corpo della classe sono le uniche indentate del blocco.
    const resto = modulo.slice(inizio + 'class ErrorKind'.length);
    const fine = resto.search(/\n(?=\S)/);
    const corpo = fine === -1 ? resto : resto.slice(0, fine);
    return [...corpo.matchAll(/^\s+([A-Z_]+)\s*=\s*'([A-Z_]+)'/gm)].map(
      (riga) => riga[2],
    );
  }

  /** I membri dell'unione `export type ErrorKind` lato backend. */
  function unioneLatoBackend(): string[] {
    const modulo = sorgente('backend', 'src', 'common', 'exceptions', 'error-kind.ts');
    const inizio = modulo.indexOf('export type ErrorKind');
    expect(inizio).toBeGreaterThanOrEqual(0);
    const dichiarazione = modulo.slice(inizio, modulo.indexOf(';', inizio));
    return [...dichiarazione.matchAll(/'([A-Z_]+)'/g)].map((voce) => voce[1]);
  }

  it('l\'enumerazione del servizio agenti contiene esattamente gli otto valori del catalogo', () => {
    // Se il lato Python ne aggiunge un nono, la tabella qui sopra e la MAP di
    // agent-error-mapping.ts vanno estese entrambe: senza questo controllo il
    // valore nuovo arriverebbe al backend e cadrebbe su UPSTREAM, cioè
    // verrebbe riportato all'utente come un guasto generico.
    expect(enumerazioneLatoAgente().sort()).toEqual([...VALORI_AGENTE].sort());
  });

  it('ogni codice prodotto dalla mappatura è dichiarato in ErrorKind lato backend', () => {
    const dichiarati = unioneLatoBackend();
    expect(dichiarati.length).toBeGreaterThan(0);
    for (const valore of VALORI_AGENTE) {
      expect(dichiarati).toContain(CORRISPONDENZA[valore]);
    }
  });

  it.each(Object.entries(CORRISPONDENZA))(
    'mappa %s sul codice %s',
    (valoreAgente, codiceAtteso) => {
      expect(mapAgentErrorKind(valoreAgente)).toBe(codiceAtteso);
    },
  );

  it('la corrispondenza è completa: nessuno degli otto valori resta scoperto', () => {
    const prodotti = VALORI_AGENTE.map((valore) => mapAgentErrorKind(valore));
    expect(prodotti).toHaveLength(VALORI_AGENTE.length);
    expect(prodotti).toEqual(VALORI_AGENTE.map((v) => CORRISPONDENZA[v]));
  });

  it('la corrispondenza è biunivoca: otto valori distinti in ingresso, otto codici distinti in uscita', () => {
    // La proprietà che serve davvero all'utente: due guasti diversi
    // dell'agente non devono presentarsi con lo stesso error.code, altrimenti
    // "contesto troppo grande" e "risorsa mancante" diventano indistinguibili
    // nella schermata dell'errore.
    const prodotti = VALORI_AGENTE.map((valore) => mapAgentErrorKind(valore));
    expect(new Set(prodotti).size).toBe(VALORI_AGENTE.length);

    // E l'inversa: da ciascun codice si risale a un solo valore d'origine.
    for (const codice of new Set(prodotti)) {
      const controimmagini = VALORI_AGENTE.filter(
        (valore) => mapAgentErrorKind(valore) === codice,
      );
      expect(controimmagini).toHaveLength(1);
    }
  });

  it('RATE_LIMITED è l\'unico rinominato attraversando il confine', () => {
    const rinominati = VALORI_AGENTE.filter(
      (valore) => mapAgentErrorKind(valore) !== valore,
    );
    expect(rinominati).toEqual(['RATE_LIMITED']);
    expect(mapAgentErrorKind('RATE_LIMITED')).toBe('LLM_RATE_LIMITED');
  });
});
