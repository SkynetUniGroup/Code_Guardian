import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import {
  AmbienteE2E,
  avviaAmbiente,
  utenteAutenticato,
} from './e2e-helpers';

/**
 * TI_06 (RF.19, 20, 22, 25, 30, RV.3) — validazione del contesto contro un
 * repository GitHub reale.
 *
 * L'unico test di questa suite che parla davvero con GitHub. Tutti gli altri
 * sostituiscono quel confine, ed e' giusto cosi': qui invece il confine *e'*
 * l'oggetto della verifica. Un doppio di GithubClientService direbbe solo
 * che il servizio si comporta come il doppio che gli abbiamo scritto
 * attorno, e non intercetterebbe mai il caso che TI_06 esiste per
 * intercettare — una risposta reale di GitHub diversa da quella che ci
 * aspettavamo.
 *
 * Si salta da solo senza un token: `E2E_GITHUB_PAT` sta in `Src/MVP/.env`
 * (gia' usato dalla suite Playwright) e viene letto da li', perche' Jest non
 * carica quel file. Nessuna scrittura, nessun consumo di credito: solo
 * chiamate di lettura all'API pubblica, sullo stesso repository che le
 * fixture degli altri test gia' nominano.
 *
 * Il repository e' configurabile con E2E_REPO_URL / E2E_REPO_BRANCH per il
 * giorno in cui il Proponente ne mettera' a disposizione uno proprio.
 */

/** Legge una variabile da Src/MVP/.env, che Jest non carica da solo. */
function daEnvDelMonorepo(chiave: string): string | undefined {
  if (process.env[chiave]) return process.env[chiave];
  try {
    const contenuto = readFileSync(
      resolve(__dirname, '..', '..', '.env'),
      'utf8',
    );
    const riga = contenuto
      .split('\n')
      .find((r) => r.trim().startsWith(`${chiave}=`));
    return riga?.slice(riga.indexOf('=') + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}

const PAT = daEnvDelMonorepo('E2E_GITHUB_PAT');
const URL_REPO =
  process.env.E2E_REPO_URL ?? 'https://github.com/OWASP/NodeGoat';
const RAMO = process.env.E2E_REPO_BRANCH ?? 'master';

const descrivi = PAT ? describe : describe.skip;

descrivi('TI_06 (RF.19,20,22,25,30, RV.3) — validazione del contesto su GitHub reale', () => {
  let ambiente: AmbienteE2E;
  let token: string;

  /** POST /contexts col corpo indicato, restituendo la risposta grezza. */
  function creaContesto(corpo: Record<string, unknown>) {
    return request(ambiente.server)
      .post('/api/v1/contexts')
      .set('Authorization', `Bearer ${token}`)
      .send(corpo);
  }

  beforeAll(async () => {
    // GithubClientService non e' sostituito: e' l'intero punto del test.
    // Il servizio agenti resta un doppio — TI_06 finisce a POST /contexts e
    // non avvia nessuna operazione.
    ambiente = await avviaAmbiente({ conGithubReale: true });

    const utente = await utenteAutenticato(ambiente.server, 'DEVELOPER');
    token = utente.token;

    // La credenziale viene verificata contro GitHub prima di essere
    // salvata: se il PAT e' scaduto il test fallisce qui, con un messaggio
    // che dice esattamente questo invece di un errore piu' avanti.
    await request(ambiente.server)
      .post('/api/v1/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'GITHUB', token: PAT })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await ambiente?.chiudi();
  });

  it('percorso di successo: ancora il contesto a uno SHA reale e conta i file', async () => {
    const risposta = await creaContesto({
      repoUrl: URL_REPO,
      branch: RAMO,
      scopeType: 'FULL_REPOSITORY',
    }).expect(201);

    // Uno SHA vero, non un segnaposto: e' cio' che rende riproducibile il
    // Report anche dopo nuovi commit sul ramo (RF.17).
    expect(risposta.body.resolvedSha).toMatch(/^[0-9a-f]{40}$/);
    expect(risposta.body.branch).toBe(RAMO);
    expect(risposta.body.isPrivate).toBe(false);
    expect(risposta.body.estimatedFileCount).toBeGreaterThan(0);
    expect(risposta.body.detectedLanguages.length).toBeGreaterThan(0);
  }, 120_000);

  it('passo 3 (RF.20, RV.3) — un repository inesistente o non visibile e\' un 404', async () => {
    // GitHub restituisce lo stesso 404 per "non esiste" e per "esiste ma
    // questo token non lo vede": i due casi non sono distinguibili dall'API,
    // ed e' la ragione per cui RepoResolverService li unisce in un solo
    // messaggio. Questo test verifica proprio quel comportamento sul campo.
    const risposta = await creaContesto({
      repoUrl: 'https://github.com/SkynetUniGroup/repository-che-non-esiste-ti06',
      branch: 'main',
      scopeType: 'FULL_REPOSITORY',
    }).expect(404);

    expect(risposta.body.code).toBe('NOT_FOUND');
  }, 120_000);

  it('passo 4 (RF.21) — un branch inesistente e\' un 404, e lo dice', async () => {
    const risposta = await creaContesto({
      repoUrl: URL_REPO,
      branch: 'ramo-che-non-esiste-ti06',
      scopeType: 'FULL_REPOSITORY',
    }).expect(404);

    expect(risposta.body.message).toContain('ramo-che-non-esiste-ti06');
  }, 120_000);

  it('passo 5 (RF.22) — un commit del ramo e\' accettato come ancoraggio', async () => {
    // Prima si ricava la testa reale del ramo, poi la si rimanda indietro
    // come commitSha: e' il caso "identical" di compareCommits, che deve
    // passare.
    const primo = await creaContesto({
      repoUrl: URL_REPO,
      branch: RAMO,
      scopeType: 'FULL_REPOSITORY',
    }).expect(201);

    const risposta = await creaContesto({
      repoUrl: URL_REPO,
      branch: RAMO,
      commitSha: primo.body.resolvedSha,
      scopeType: 'FULL_REPOSITORY',
    }).expect(201);

    expect(risposta.body.resolvedSha).toBe(primo.body.resolvedSha);
  }, 120_000);

  it('passo 9 (RF.30) — un percorso assente dall\'albero reale e\' respinto', async () => {
    const risposta = await creaContesto({
      repoUrl: URL_REPO,
      branch: RAMO,
      scopeType: 'FILES',
      paths: ['questo/percorso/non/esiste-ti06.ts'],
    }).expect(400);

    expect(risposta.body.code).toBe('VALIDATION_ERROR');
  }, 120_000);

  it('passo 9 (RF.30) — un percorso presente nell\'albero reale e\' accettato', async () => {
    // Il controllo positivo dello stesso passo: senza, "respinge tutto"
    // soddisfarebbe il test precedente.
    const albero = await request(ambiente.server)
      .get('/api/v1/repositories/tree')
      .query({ repoUrl: URL_REPO, branch: RAMO })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const primoFile = (albero.body.entries as { type: string; path: string }[])
      .find((n) => n.type === 'file');
    expect(primoFile).toBeDefined();

    const risposta = await creaContesto({
      repoUrl: URL_REPO,
      branch: RAMO,
      scopeType: 'FILES',
      paths: [primoFile.path],
    }).expect(201);

    expect(risposta.body.scopeType).toBe('FILES');
    expect(risposta.body.estimatedFileCount).toBe(1);
  }, 120_000);
});
