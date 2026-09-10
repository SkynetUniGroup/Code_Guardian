import request from "supertest";
import {
  AmbienteE2E,
  attendiEsito,
  avviaAmbiente,
  daEnvDelMonorepo,
  URL_REPO,
  utenteAutenticato,
} from "./e2e-helpers";

/**
 * TI_16 (RV.4) — selezione del contesto ed esecuzione su un repository
 * privato, con lo stesso esito che si ottiene su uno pubblico.
 *
 * Stato atteso oggi: SALTATO. La funzionalità nel prodotto c'è —
 * `RepoResolverService` legge `isPrivate` dalla risposta di GitHub e lo
 * porta fino al contesto persistito, e distingue già il caso del
 * repository privato che il token non vede — ma manca il fixture: un
 * repository privato di prova e un token che possa vederlo. Finché il
 * gruppo non lo mette a disposizione, il test si dichiara saltato invece
 * di fallire, come fa la suite Playwright quando manca il PAT.
 *
 * Perché GitHub non è sostituito: RV.4 riguarda esattamente il confine con
 * GitHub, cioè se l'autorizzazione funziona su un repository non pubblico.
 * Un doppio risponderebbe `isPrivate: true` perché gliel'abbiamo detto noi,
 * e il test non verificherebbe nulla. Il servizio agenti invece resta un
 * doppio: la voce parla del flusso di selezione ed esecuzione, non della
 * qualità dell'analisi, e un modello reale aggiungerebbe costo e
 * variabilità senza aggiungere verifica.
 *
 * Perché il confronto col repository pubblico è dentro il test e non
 * lasciato al lettore: la voce non dice «funziona», dice «completi con
 * successo esattamente come su un repository pubblico». È una proprietà
 * relativa, e si dimostra eseguendo lo stesso flusso due volte e
 * confrontando gli esiti, non asserendo separatamente su uno solo dei due.
 *
 * Per abilitarlo, in `Src/MVP/.env`:
 *
 *   E2E_PRIVATE_REPO_URL=https://github.com/<owner>/<repo-privato>
 *   E2E_PRIVATE_REPO_BRANCH=main          (facoltativa, default "main")
 *   E2E_PRIVATE_REPO_PAT=<token>          (facoltativa: senza, usa E2E_GITHUB_PAT)
 *
 * Il token deve poter vedere il repository privato: se non lo vede, GitHub
 * risponde 404 come per un repository inesistente e il test fallisce sulla
 * creazione del contesto, che è il modo corretto di accorgersene.
 */

const URL_PRIVATO = daEnvDelMonorepo("E2E_PRIVATE_REPO_URL");
const RAMO_PRIVATO = daEnvDelMonorepo("E2E_PRIVATE_REPO_BRANCH") ?? "main";
const PAT = daEnvDelMonorepo("E2E_PRIVATE_REPO_PAT") ?? daEnvDelMonorepo("E2E_GITHUB_PAT");

const RAMO_PUBBLICO = "master";

const configurato = Boolean(URL_PRIVATO && PAT);
const descrivi = configurato ? describe : describe.skip;

descrivi("TI_16 (RV.4) — contesto ed esecuzione su repository privato", () => {
  let ambiente: AmbienteE2E;
  let token: string;

  /** Esito osservabile di un contesto, per confrontare privato e pubblico. */
  interface EsitoContesto {
    contextId: string;
    isPrivate: boolean;
    resolvedSha: string;
    estimatedFileCount: number;
    linguaggi: number;
  }

  async function creaContesto(repoUrl: string, branch: string): Promise<EsitoContesto> {
    const risposta = await request(ambiente.server)
      .post("/api/v1/contexts")
      .set("Authorization", `Bearer ${token}`)
      .send({ repoUrl, branch, scopeType: "FULL_REPOSITORY" })
      .expect(201);

    return {
      contextId: risposta.body.id,
      isPrivate: risposta.body.isPrivate,
      resolvedSha: risposta.body.resolvedSha,
      estimatedFileCount: risposta.body.estimatedFileCount,
      linguaggi: risposta.body.detectedLanguages.length,
    };
  }

  /** Avvia un'operazione sul contesto e ne attende l'esito. */
  async function eseguiOperazione(contextId: string) {
    ambiente.agente.invoke.mockResolvedValue({
      status: "COMPLETED",
      payload: {
        body: [{ kind: "TEXT", markdown: "Analisi conclusa." }],
        summary: "Nessun riscontro.",
        tokensConsumed: 120,
      },
    });

    const avvio = await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ contextId, operations: ["SECURITY_OWASP"] })
      .expect(202);

    return attendiEsito(ambiente.taskModel, avvio.body.taskIds[0] as string);
  }

  beforeAll(async () => {
    ambiente = await avviaAmbiente({ conGithubReale: true });

    const utente = await utenteAutenticato(ambiente.server, "SECURITY_AUDITOR");
    token = utente.token;

    await request(ambiente.server)
      .post("/api/v1/credentials")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: "GITHUB", token: PAT })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await ambiente?.chiudi();
  });

  beforeEach(() => {
    ambiente.agente.invoke.mockReset();
    ambiente.agente.resume.mockReset();
  });

  it("il contesto su un repository privato è creato e riconosciuto come privato", async () => {
    const privato = await creaContesto(URL_PRIVATO!, RAMO_PRIVATO);

    expect(privato.isPrivate).toBe(true);
    expect(privato.resolvedSha).toMatch(/^[0-9a-f]{40}$/);
    expect(privato.estimatedFileCount).toBeGreaterThan(0);
  }, 180_000);

  it("un repository pubblico resta riconosciuto come pubblico", async () => {
    // Il controllo positivo del campo su cui poggia tutto il resto: senza,
    // `isPrivate: true` sarebbe indistinguibile da un campo cablato a true.
    const pubblico = await creaContesto(URL_REPO, RAMO_PUBBLICO);

    expect(pubblico.isPrivate).toBe(false);
  }, 180_000);

  it("l’operazione completa sul privato esattamente come sul pubblico", async () => {
    const privato = await creaContesto(URL_PRIVATO!, RAMO_PRIVATO);
    const pubblico = await creaContesto(URL_REPO, RAMO_PUBBLICO);

    const suPrivato = await eseguiOperazione(privato.contextId);
    const suPubblico = await eseguiOperazione(pubblico.contextId);

    // Gli esiti si confrontano fra loro, non con un valore atteso scritto
    // qui: è la formulazione della voce, e regge anche se un domani il
    // flusso cambia per entrambi.
    expect({
      stato: suPrivato.status,
      errore: suPrivato.error,
      haReport: Boolean(suPrivato.reportId),
    }).toEqual({
      stato: suPubblico.status,
      errore: suPubblico.error,
      haReport: Boolean(suPubblico.reportId),
    });
    expect(suPrivato.status).toBe("COMPLETED");
  }, 300_000);

  it("il Report prodotto sul privato è leggibile dal suo proprietario", async () => {
    const privato = await creaContesto(URL_PRIVATO!, RAMO_PRIVATO);
    const conclusa = await eseguiOperazione(privato.contextId);

    const report = await request(ambiente.server)
      .get(`/api/v1/reports/${String(conclusa.reportId)}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(report.body.status).toBe("COMPLETED");
    expect(report.body.operation).toBe("SECURITY_OWASP");
  }, 300_000);
});
