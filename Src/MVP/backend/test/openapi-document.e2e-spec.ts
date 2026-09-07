import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AmbienteE2E, avviaAmbiente } from './e2e-helpers';

/**
 * TU_27 (RV.16) — il documento OpenAPI generato dal backend.
 *
 * Sta fra i test di integrazione e non fra quelli di unita', pur essendo
 * catalogato TU: `SwaggerModule.createDocument` vuole un'applicazione Nest
 * gia' costruita, e costruire l'AppModule vuole MongoDB e Redis. Metterlo in
 * `src/**\/*.spec.ts` avrebbe reso `npx jest` dipendente da Docker per tutta
 * la suite di unita'. La scelta e' segnalata invece che nascosta.
 *
 * Corrispondenza PARZIALE, per due motivi distinti.
 *
 * Il primo e' una decisione di progetto: RV.16 chiede la validita' "secondo
 * lo schema OpenAPI 3.0", e validare contro lo schema formale richiede un
 * validatore che il progetto non ha fra le dipendenze. Qui si verificano le
 * proprieta' che si controllano senza aggiungerne uno — versione dichiarata,
 * `info`, `paths`, ogni operazione con le sue risposte descritte, ogni
 * parametro di percorso tipizzato — piu' la seconda meta' del requisito,
 * cioe' che ogni endpoint pubblico *esista* nel documento col proprio
 * metodo. Non e' una validazione completa contro lo schema e non viene
 * spacciata per tale.
 *
 * Il secondo e' un difetto aperto con tre facce, una per `it.failing`:
 * nessuna operazione dichiara lo schema della propria risposta, nessun
 * parametro di query e' documentato, e gli schemi dei corpi di richiesta
 * sono gusci vuoti. La causa e' unica: nei controller non c'e' un solo
 * decoratore @ApiResponse/@ApiQuery/@ApiProperty, e nest-cli.json non
 * abilita il plugin di @nestjs/swagger che li dedurrebbe dai tipi. La
 * conseguenza pratica e' che un client scritto leggendo questo documento
 * chiama GET /reports/{id}/export senza `format=pdf` e riceve un 400, e non
 * sa quali campi mettere nel corpo di POST /auth/register.
 */
describe('TU_27 (RV.16) — documento OpenAPI del backend', () => {
  let ambiente: AmbienteE2E;
  let documento: Record<string, unknown>;

  const METODI_HTTP = ['get', 'post', 'put', 'patch', 'delete'];

  interface Operazione {
    parameters?: {
      name: string;
      in: string;
      required?: boolean;
      schema?: unknown;
    }[];
    responses?: Record<string, { description?: string; content?: unknown }>;
    requestBody?: {
      content?: Record<string, { schema?: { $ref?: string } }>;
    };
  }

  /** Le operazioni del documento, come terne percorso/metodo/definizione. */
  function operazioni(): { percorso: string; metodo: string; op: Operazione }[] {
    const paths = documento.paths as Record<string, Record<string, Operazione>>;
    return Object.entries(paths).flatMap(([percorso, perMetodo]) =>
      Object.entries(perMetodo)
        .filter(([metodo]) => METODI_HTTP.includes(metodo))
        .map(([metodo, op]) => ({ percorso, metodo, op })),
    );
  }

  /**
   * Le rotte che l'applicazione serve davvero, lette dal router di Express
   * dopo l'inizializzazione.
   *
   * E' la sola fonte che non puo' divergere da cio' che gira: un elenco
   * riscritto qui a mano direbbe soltanto che questo file e' coerente con se
   * stesso, ed e' esattamente l'endpoint dimenticato il caso che RV.16 deve
   * intercettare.
   */
  function rotteRegistrate(): string[] {
    const express = ambiente.app.getHttpAdapter().getInstance() as unknown as {
      router?: { stack: unknown[] };
      _router?: { stack: unknown[] };
    };
    const router = express.router ?? express._router;
    if (!router?.stack) {
      throw new Error(
        'Il router di Express non e\' raggiungibile: TU_27 non puo\' confrontare ' +
          'le rotte registrate con quelle documentate.',
      );
    }

    const strati = router.stack as {
      route?: { path: string; methods: Record<string, boolean> };
    }[];

    return strati
      .filter((strato) => strato.route)
      .flatMap((strato) =>
        Object.keys(strato.route!.methods)
          .filter((metodo) => METODI_HTTP.includes(metodo))
          // Express scrive :id, OpenAPI scrive {id}: stessa rotta, due notazioni.
          .map(
            (metodo) =>
              `${metodo} ${strato.route!.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`,
          ),
      );
  }

  /** Le rotte interne, fuori dal perimetro pubblico di RV.16. */
  function eInterna(rotta: string): boolean {
    return rotta.includes('/internal/');
  }

  beforeAll(async () => {
    ambiente = await avviaAmbiente();
    // Le stesse impostazioni di main.ts: un documento costruito con altri
    // parametri non sarebbe quello che il backend pubblica su /api/docs.
    const config = new DocumentBuilder()
      .setTitle('Code Guardian — Backend MVP')
      .setDescription('API del backend di Code Guardian')
      .setVersion('0.1')
      .addBearerAuth()
      .build();
    documento = SwaggerModule.createDocument(
      ambiente.app,
      config,
    ) as unknown as Record<string, unknown>;
  }, 60_000);

  afterAll(async () => {
    await ambiente?.chiudi();
  });

  it('dichiara la versione OpenAPI 3.0 e le informazioni obbligatorie', () => {
    expect(documento.openapi).toMatch(/^3\.0\.\d+$/);

    const info = documento.info as { title?: string; version?: string };
    expect(info?.title?.length).toBeGreaterThan(0);
    expect(info?.version?.length).toBeGreaterThan(0);
    expect(Object.keys(documento.paths as object).length).toBeGreaterThan(0);
  });

  it('ogni operazione dichiara almeno una risposta, e ogni risposta ha una descrizione', () => {
    // `description` e' obbligatoria sul Response Object in OpenAPI 3.0: e'
    // la parte dello schema che si puo' verificare senza un validatore.
    const senzaRisposte = operazioni()
      .filter(({ op }) => Object.keys(op.responses ?? {}).length === 0)
      .map(({ metodo, percorso }) => `${metodo} ${percorso}`);
    expect(senzaRisposte).toEqual([]);

    const senzaDescrizione = operazioni().flatMap(({ percorso, metodo, op }) =>
      Object.entries(op.responses ?? {})
        .filter(([, risposta]) => typeof risposta.description !== 'string')
        .map(([codice]) => `${metodo} ${percorso} -> ${codice}`),
    );
    expect(senzaDescrizione).toEqual([]);
  });

  it('ogni parametro di percorso e\' documentato come obbligatorio e tipizzato', () => {
    const mancanti = operazioni().flatMap(({ percorso, metodo, op }) => {
      const segnaposto = [...percorso.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      return segnaposto
        .filter((nome) => {
          const parametro = (op.parameters ?? []).find(
            (p) => p.name === nome && p.in === 'path',
          );
          return !parametro || parametro.required !== true || !parametro.schema;
        })
        .map((nome) => `${metodo} ${percorso} -> {${nome}}`);
    });

    expect(mancanti).toEqual([]);
  });

  it('ogni endpoint pubblico servito dall\'applicazione compare nel documento', () => {
    const registrate = rotteRegistrate().filter((r) => !eInterna(r));
    const documentate = operazioni().map(
      ({ metodo, percorso }) => `${metodo} ${percorso}`,
    );

    expect(registrate.length).toBeGreaterThan(20);
    expect(registrate.filter((r) => !documentate.includes(r))).toEqual([]);
  });

  it('il documento non promette endpoint che l\'applicazione non serve', () => {
    // L'errore speculare, altrettanto dannoso per chi integra: una rotta
    // rimossa dal codice e rimasta nella documentazione.
    const registrate = rotteRegistrate();
    const documentate = operazioni().map(
      ({ metodo, percorso }) => `${metodo} ${percorso}`,
    );

    expect(documentate.filter((r) => !registrate.includes(r))).toEqual([]);
  });

  it('gli endpoint interni restano fuori dal documento pubblico', () => {
    // RV.16 riguarda gli endpoint pubblici. Quelli fra backend e agenti sono
    // esclusi con @ApiExcludeController e non devono comparire: sono protetti
    // da HMAC e documentarli non aiuterebbe nessun cliente legittimo.
    const interne = rotteRegistrate().filter(eInterna);
    expect(interne.length).toBeGreaterThan(0);

    const documentate = operazioni().map(
      ({ metodo, percorso }) => `${metodo} ${percorso}`,
    );
    expect(interne.filter((r) => documentate.includes(r))).toEqual([]);
  });

  /** Gli schemi dichiarati in components. */
  function schemiDichiarati(): Record<string, { properties?: object }> {
    return (
      documento.components as {
        schemas?: Record<string, { properties?: object }>;
      }
    ).schemas!;
  }

  /** Le operazioni che accettano un corpo, col riferimento al loro schema. */
  function corpiDiRichiesta(): { etichetta: string; riferimento?: string }[] {
    return operazioni()
      .filter(({ op }) => op.requestBody)
      .map(({ percorso, metodo, op }) => ({
        etichetta: `${metodo} ${percorso}`,
        riferimento: op.requestBody?.content?.['application/json']?.schema?.$ref,
      }));
  }

  it('ogni corpo di richiesta rimanda a uno schema dichiarato in components', () => {
    const schemi = schemiDichiarati();
    const corpi = corpiDiRichiesta();
    expect(corpi.length).toBeGreaterThanOrEqual(5);

    const irrisolti = corpi.filter(({ riferimento }) => {
      if (!riferimento) return true;
      return !(riferimento.replace('#/components/schemas/', '') in schemi);
    });

    expect(irrisolti.map((c) => c.etichetta)).toEqual([]);
  });

  it.failing(
    'RV.16 — DIFETTO APERTO: gli schemi dei corpi di richiesta sono vuoti',
    () => {
      // Terza faccia dello stesso difetto: senza @ApiProperty sui campi dei
      // DTO (e senza il plugin), ogni schema e' {type:'object',
      // properties:{}}. Il documento dice come si chiama il corpo di una
      // POST /auth/register, non che vuole firstName, lastName, email,
      // password e role.
      const schemi = schemiDichiarati();
      const vuoti = Object.entries(schemi)
        .filter(([, schema]) => Object.keys(schema.properties ?? {}).length === 0)
        .map(([nome]) => nome);

      expect(vuoti).toEqual([]);
    },
  );

  it.failing(
    'RV.16 — DIFETTO APERTO: nessuna operazione documenta lo schema della propria risposta',
    () => {
      // Senza @ApiResponse (e senza il plugin di @nestjs/swagger in
      // nest-cli.json), ogni risposta e' un guscio: codice di stato e
      // descrizione vuota, nessun `content`. Chi integra non sa cosa
      // riceve, che e' meta' di cio' che RV.16 chiede.
      const senzaSchema = operazioni()
        .filter(({ op }) =>
          Object.values(op.responses ?? {}).every(
            (risposta) => !risposta.content,
          ),
        )
        .map(({ metodo, percorso }) => `${metodo} ${percorso}`);

      expect(senzaSchema).toEqual([]);
    },
  );

  it.failing(
    'RV.16 — DIFETTO APERTO: i parametri di query non sono documentati',
    () => {
      // Il caso che si tocca con mano: GET /reports/{id}/export accetta un
      // ExportReportQueryDto con `format` obbligatorio, e il documento non
      // lo nomina. Un client scritto leggendo la documentazione chiama
      // l'endpoint senza quel parametro e riceve un 400.
      const esportazione = operazioni().find(
        ({ percorso, metodo }) =>
          percorso.endsWith('/export') && metodo === 'get',
      );
      expect(esportazione).toBeDefined();

      const format = (esportazione!.op.parameters ?? []).find(
        (p) => p.name === 'format' && p.in === 'query',
      );
      expect(format).toBeDefined();
      expect(format!.required).toBe(true);
    },
  );
});
