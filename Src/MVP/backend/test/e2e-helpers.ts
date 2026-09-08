import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { FRANC } from './../src/contexts/franc.provider';
import { GithubClientService } from './../src/github/github-client.service';
import { GithubWriteService } from './../src/github/github-write.service';
import { AgentInvocationService } from './../src/tasks/agent-invocation.service';
import { Task, TaskDocument } from './../src/tasks/schemas/task.schema';
import {
  UsageCounter,
  UsageCounterDocument,
} from './../src/tasks/schemas/usage-counter.schema';
import { Report, ReportDocument } from './../src/reports/schemas/report.schema';
import { RunTaskJobData } from './../src/tasks/task-processor';

/**
 * Impalcatura condivisa dei test di integrazione.
 *
 * Ricalca quella di task-lifecycle.e2e-spec.ts, che resta il modello: gira il
 * vero AppModule contro MongoDB e Redis reali e sostituisce solo i confini
 * effettivamente esterni al sistema — GitHub e il servizio agenti Python.
 * Estratta qui perche' i test aggiunti dopo TI_05 sono sei e la
 * ricostruivano identica ciascuno; task-lifecycle.e2e-spec.ts non e' stato
 * toccato, la sua copia funziona ed e' il riferimento con cui confrontare
 * questa.
 *
 * Va eseguita con la coda in esclusiva: l'AppModule registra un worker
 * BullMQ, quindi un backend di sviluppo acceso sullo stesso Redis
 * consumerebbe i job di questi test col servizio agenti reale invece che col
 * doppio.
 */

export const URL_REPO = 'https://github.com/OWASP/NodeGoat';

/** Alberatura minima che la validazione del contesto si aspetta da GitHub. */
export const ALBERO = [
  { path: 'app/data/user-dao.js', type: 'file' as const, sizeBytes: 2048 },
  { path: 'app/routes/session.js', type: 'file' as const, sizeBytes: 1024 },
];

const REPOSITORY = {
  owner: 'OWASP',
  name: 'NodeGoat',
  isPrivate: false,
  defaultBranch: 'master',
  primaryLanguage: 'JavaScript',
};

export interface DoppioGithub {
  verifyToken: jest.Mock;
  listRepositories: jest.Mock;
  getRepository: jest.Mock;
  resolveRefToSha: jest.Mock;
  getTree: jest.Mock;
  getFileContent: jest.Mock;
  getReadme: jest.Mock;
  listRefs: jest.Mock;
  listIssues: jest.Mock;
  getIssueDetail: jest.Mock;
}

/** Doppio di GitHub in lettura: nessuna rete, risposte deterministiche. */
export function doppioGithub(): DoppioGithub {
  return {
    verifyToken: jest
      .fn()
      .mockResolvedValue({ scopes: ['repo'], login: 'utente-di-prova' }),
    listRepositories: jest.fn().mockResolvedValue([REPOSITORY]),
    getRepository: jest.fn().mockResolvedValue(REPOSITORY),
    resolveRefToSha: jest.fn().mockResolvedValue('abc1234567890'),
    getTree: jest.fn().mockResolvedValue(ALBERO),
    getFileContent: jest.fn().mockResolvedValue({
      path: 'app/data/user-dao.js',
      content: 'function login() {}',
      sha: 'file-sha',
      language: 'JavaScript',
    }),
    getReadme: jest.fn().mockResolvedValue(null),
    listRefs: jest.fn().mockResolvedValue({
      branches: [{ name: 'master', sha: 'abc1234567890' }],
      tags: [],
    }),
    listIssues: jest.fn().mockResolvedValue([]),
    getIssueDetail: jest.fn(),
  };
}

export interface DoppioAgente {
  invoke: jest.Mock;
  resume: jest.Mock;
}

/** Doppio del servizio agenti: ogni test decide come deve rispondere. */
export function doppioAgente(): DoppioAgente {
  return { invoke: jest.fn(), resume: jest.fn() };
}

export interface DoppioScritturaGithub {
  openPullRequestForProposal: jest.Mock;
}

export interface AmbienteE2E {
  app: INestApplication<App>;
  server: App;
  github: DoppioGithub;
  agente: DoppioAgente;
  scritturaGithub: DoppioScritturaGithub;
  coda: Queue<RunTaskJobData>;
  taskModel: Model<TaskDocument>;
  reportModel: Model<ReportDocument>;
  usageModel: Model<UsageCounterDocument>;
  chiudi: () => Promise<void>;
}

export interface OpzioniAmbiente {
  /** Sostituisce anche GithubWriteService, per i test sull'apertura di PR. */
  conScritturaGithub?: boolean;
  /**
   * Lascia in piedi AgentInvocationService vero, sostituendo il confine piu'
   * in basso: la chiamata HTTP al servizio agenti. Serve ai test che devono
   * esercitare la traduzione fra la risposta dell'agente e l'esito della
   * task — sostituire il servizio la salterebbe insieme al resto.
   */
  conAgenteReale?: boolean;
  /**
   * Lascia in piedi GithubClientService vero, cioe' chiamate reali all'API
   * di GitHub. Solo per i test che verificano proprio quel confine, e solo
   * con un token valido a disposizione.
   */
  conGithubReale?: boolean;
}

/**
 * Avvia l'applicazione reale con i due confini esterni sostituiti.
 *
 * Le impostazioni della pipe e del filtro sono le stesse di main.ts: senza
 * la pipe i DTO non verrebbero validati, senza il filtro il corpo degli
 * errori non porterebbe il campo `code` su cui questi test asseriscono.
 */
export async function avviaAmbiente(
  opzioni: OpzioniAmbiente = {},
): Promise<AmbienteE2E> {
  const github = doppioGithub();
  const agente = doppioAgente();
  const scritturaGithub: DoppioScritturaGithub = {
    openPullRequestForProposal: jest.fn(),
  };

  let costruttore = Test.createTestingModule({ imports: [AppModule] })
    // franc-min e' ESM-only e viene risolto con un import() dinamico, che
    // Jest non sa eseguire senza --experimental-vm-modules (lo dichiara il
    // commento in franc.provider.ts). E' una libreria di terze parti per il
    // riconoscimento della lingua: sostituirla non tocca la logica in esame.
    .overrideProvider(FRANC)
    .useValue(() => 'eng');

  if (!opzioni.conGithubReale) {
    costruttore = costruttore
      .overrideProvider(GithubClientService)
      .useValue(github);
  }

  if (!opzioni.conAgenteReale) {
    costruttore = costruttore
      .overrideProvider(AgentInvocationService)
      .useValue(agente);
  }

  if (opzioni.conScritturaGithub) {
    costruttore = costruttore
      .overrideProvider(GithubWriteService)
      .useValue(scritturaGithub);
  }

  const modulo: TestingModule = await costruttore.compile();

  const app = modulo.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('api/v1');
  await app.init();

  return {
    app,
    server: app.getHttpServer(),
    github,
    agente,
    scritturaGithub,
    coda: app.get<Queue<RunTaskJobData>>(getQueueToken('tasks')),
    taskModel: app.get<Model<TaskDocument>>(getModelToken(Task.name)),
    reportModel: app.get<Model<ReportDocument>>(getModelToken(Report.name)),
    usageModel: app.get<Model<UsageCounterDocument>>(
      getModelToken(UsageCounter.name),
    ),
    chiudi: () => app.close(),
  };
}

export interface UtenteDiProva {
  token: string;
  userId: string;
  email: string;
}

/** Registra un utente nuovo e apre una sessione. */
export async function utenteAutenticato(
  server: App,
  role = 'SECURITY_AUDITOR',
): Promise<UtenteDiProva> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@esempio.invalid`;
  const password = 'password-di-prova-123';

  const registrazione = await request(server)
    .post('/api/v1/auth/register')
    .send({ firstName: 'Ada', lastName: 'Lovelace', email, password, role })
    .expect(201);

  const accesso = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);

  return {
    token: accesso.body.accessToken as string,
    userId: registrazione.body.id as string,
    email,
  };
}

/** Salva la credenziale GitHub che ogni operazione richiede. */
export async function salvaCredenziale(
  server: App,
  token: string,
): Promise<void> {
  await request(server)
    .post('/api/v1/credentials')
    .set('Authorization', `Bearer ${token}`)
    .send({ provider: 'GITHUB', token: 'ghp_token_di_prova_0123456789' })
    .expect(201);
}

/** Crea un contesto di analisi sull'intero repository. */
export async function creaContesto(
  server: App,
  token: string,
): Promise<string> {
  const risposta = await request(server)
    .post('/api/v1/contexts')
    .set('Authorization', `Bearer ${token}`)
    .send({ repoUrl: URL_REPO, branch: 'master', scopeType: 'FULL_REPOSITORY' })
    .expect(201);

  return risposta.body.id as string;
}

/** Utente autenticato, con credenziale e contesto gia' pronti. */
export async function utentePronto(
  server: App,
  role = 'SECURITY_AUDITOR',
): Promise<UtenteDiProva & { contextId: string }> {
  const utente = await utenteAutenticato(server, role);
  await salvaCredenziale(server, utente.token);
  const contextId = await creaContesto(server, utente.token);
  return { ...utente, contextId };
}

/**
 * Attende che una task raggiunga uno stato terminale.
 *
 * Il worker BullMQ registrato dall'AppModule consuma la coda da solo: il
 * test non deve invocare il processore a mano — lo farebbe in corsa con lui
 * — ma osservare l'esito del percorso reale.
 */
export async function attendiEsito(
  taskModel: Model<TaskDocument>,
  taskId: string,
  timeoutMs = 20_000,
): Promise<TaskDocument> {
  const scadenza = Date.now() + timeoutMs;
  while (Date.now() < scadenza) {
    const task = await taskModel.findById(taskId);
    if (task && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status)) {
      return task;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `La task ${taskId} non ha raggiunto uno stato terminale in ${timeoutMs}ms`,
  );
}

/** Attende che una condizione si verifichi, per le attese non terminali. */
export async function attendiChe(
  condizione: () => Promise<boolean>,
  descrizione: string,
  timeoutMs = 20_000,
): Promise<void> {
  const scadenza = Date.now() + timeoutMs;
  while (Date.now() < scadenza) {
    if (await condizione()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Condizione non verificata in ${timeoutMs}ms: ${descrizione}`);
}

/**
 * Legge una variabile da `Src/MVP/.env`, che Jest non carica da solo.
 *
 * Quel file raccoglie le variabili dei test contro servizi reali
 * (`E2E_GITHUB_PAT` e simili) ed e' gia' usato dalla suite Playwright; i
 * test di integrazione che toccano GitHub lo leggono da qui invece di
 * pretendere che l'operatore le esporti a mano prima di ogni esecuzione.
 * Una variabile gia' presente nell'ambiente ha comunque la precedenza.
 */
export function daEnvDelMonorepo(chiave: string): string | undefined {
  if (process.env[chiave]) return process.env[chiave];
  try {
    const contenuto = readFileSync(resolve(__dirname, '..', '..', '.env'), 'utf8');
    const riga = contenuto
      .split('\n')
      .find((r) => r.trim().startsWith(`${chiave}=`));
    return riga?.slice(riga.indexOf('=') + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}
