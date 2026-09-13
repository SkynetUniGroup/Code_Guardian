import { HttpStatus } from "@nestjs/common";
import request from "supertest";
import { AppException } from "./../src/common/exceptions/app.exception";
import { TaskDocument } from "./../src/tasks/schemas/task.schema";
import { AmbienteE2E, attendiEsito, avviaAmbiente, utentePronto } from "./e2e-helpers";

/**
 * TI_12 (RF.82, RF.63) e TI_13 (RF.72) — apertura automatica della Pull
 * Request a partire dalla Proposal dell'agente.
 *
 * I due casi stanno nello stesso file perche' riguardano lo stesso anello
 * mancante, e vale la pena vederli accanto.
 *
 * Il difetto che questo file documentava — il backend non apriva alcuna
 * Pull Request, perche' `openPullRequestForProposal` non era chiamato da
 * nessun punto del codice di produzione — su questa base non c'e' piu':
 * ProposalPublisherService chiude l'anello, e i due casi TI_12 sono test
 * normali. Resta aperto il solo TI_13, marcato `it.fails` in fondo: il
 * rifiuto di GitHub non porta ancora la task a FAILED con
 * PR_CREATION_FAILED.
 *
 * Di conseguenza RF.72 non e' osservabile: `PR_CREATION_FAILED` e' dichiarato
 * in ErrorKind e sollevato da GithubWriteService, ma nessuna task puo'
 * riceverlo, perche' nessuna task chiama quel metodo.
 *
 * Cio' che invece funziona — la Proposal che attraversa il confine, viene
 * sanificata e persistita nel Report — e' verificato dai test che passano
 * qui sopra: servono anche a garantire che gli `it.failing` sotto falliscano
 * per il difetto e non per un'impalcatura rotta.
 *
 * Distinto dal difetto gia' noto sul corpo del Report che non attraversa il
 * confine agenti/frontend: quello riguarda i nomi dei campi dei blocchi ed
 * e' assegnato ad altri. Qui manca proprio la chiamata.
 */
describe("TI_12 (RF.82, RF.63) / TI_13 (RF.72) — apertura automatica della Pull Request", () => {
  let ambiente: AmbienteE2E;

  const PROPOSTA = {
    targetPath: "README.md",
    diffUnified:
      "--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # NodeGoat\n+Guida introduttiva.\n",
    language: "markdown",
    pullRequestUrl: null as string | null,
  };

  /** Esegue una DOCS_README il cui agente restituisce la Proposal indicata. */
  async function eseguiDocsReadme(
    utente: { token: string; contextId: string },
    proposta: typeof PROPOSTA = PROPOSTA,
  ): Promise<TaskDocument> {
    ambiente.agente.invoke.mockResolvedValue({
      status: "COMPLETED",
      payload: {
        body: [
          {
            kind: "TEXT",
            markdown: "README aggiornato con la guida introduttiva.",
          },
        ],
        proposal: proposta,
        summary: "Proposta una modifica al README.",
        tokensConsumed: 220,
      },
    });

    const avvio = await request(ambiente.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${utente.token}`)
      .send({ contextId: utente.contextId, operations: ["DOCS_README"] })
      .expect(202);

    return attendiEsito(ambiente.taskModel, avvio.body.taskIds[0] as string);
  }

  /** Il Report letto dall'API, come lo vede l'interfaccia. */
  async function reportLetto(token: string, reportId: unknown) {
    const risposta = await request(ambiente.server)
      .get(`/api/v1/reports/${String(reportId)}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return risposta.body;
  }

  beforeAll(async () => {
    ambiente = await avviaAmbiente({ conScritturaGithub: true });
  }, 60_000);

  afterAll(async () => {
    await ambiente?.chiudi();
  });

  beforeEach(() => {
    ambiente.agente.invoke.mockReset();
    ambiente.agente.resume.mockReset();
    ambiente.scritturaGithub.openPullRequestForProposal.mockReset();
    ambiente.scritturaGithub.openPullRequestForProposal.mockResolvedValue(
      "https://github.com/OWASP/NodeGoat/pull/42",
    );
  });

  it("la Proposal dell'agente arriva persistita nel Report e leggibile via API", async () => {
    const utente = await utentePronto(ambiente.server, "DEVELOPER");

    const conclusa = await eseguiDocsReadme(utente);

    expect(conclusa.status).toBe("COMPLETED");
    const report = await reportLetto(utente.token, conclusa.reportId);
    expect(report.proposal).toMatchObject({
      targetPath: "README.md",
      language: "markdown",
    });
    expect(report.proposal.diffUnified).toContain("+Guida introduttiva.");
  }, 180_000);

  it("un collegamento alla PR gia' valorizzato sopravvive fino all'API", async () => {
    // L'unica strada per cui oggi un pullRequestUrl puo' comparire in un
    // Report: che sia l'agente a fornirlo. Verificarlo serve a distinguere
    // "il campo non attraversa il confine" da "nessuno lo riempie", che sono
    // difetti diversi con correzioni diverse.
    const utente = await utentePronto(ambiente.server, "DEVELOPER");

    const conclusa = await eseguiDocsReadme(utente, {
      ...PROPOSTA,
      pullRequestUrl: "https://github.com/OWASP/NodeGoat/pull/7",
    });

    const report = await reportLetto(utente.token, conclusa.reportId);
    expect(report.proposal.pullRequestUrl).toBe("https://github.com/OWASP/NodeGoat/pull/7");
  }, 180_000);

  it("un collegamento con schema pericoloso viene scartato, il resto della Proposal resta", async () => {
    const utente = await utentePronto(ambiente.server, "DEVELOPER");

    const conclusa = await eseguiDocsReadme(utente, {
      ...PROPOSTA,
      pullRequestUrl: "javascript:alert(1)",
    });

    const report = await reportLetto(utente.token, conclusa.reportId);
    expect(report.proposal.pullRequestUrl).toBeNull();
    expect(report.proposal.targetPath).toBe("README.md");
  }, 180_000);

  it("TI_12 — ricevuta la Proposal, il backend apre la Pull Request", async () => {
    // RF.82: l'apertura della PR deve essere automatica, non un'azione che
    // l'utente compie altrove copiando il diff a mano.
    const utente = await utentePronto(ambiente.server, "DEVELOPER");

    await eseguiDocsReadme(utente);

    expect(ambiente.scritturaGithub.openPullRequestForProposal).toHaveBeenCalledTimes(1);
  }, 180_000);

  it("TI_12 — il Report porta il collegamento alla PR aperta dal backend", async () => {
    // RF.63: il collegamento va persistito nel Report, che e' il posto in
    // cui l'utente torna a cercarlo dopo.
    const utente = await utentePronto(ambiente.server, "DEVELOPER");

    const conclusa = await eseguiDocsReadme(utente);

    const report = await reportLetto(utente.token, conclusa.reportId);
    expect(report.proposal.pullRequestUrl).toBe("https://github.com/OWASP/NodeGoat/pull/42");
  }, 180_000);

  it.fails("TI_13 — DIFETTO APERTO: il rifiuto di GitHub non porta la task a FAILED con PR_CREATION_FAILED", async () => {
    // RF.72: il Report col diff esiste gia', quindi il fallimento riguarda
    // solo l'apertura della PR — e deve essere riconoscibile come tale,
    // non confuso con un guasto dell'agente. Oggi la task completa senza
    // accorgersi di niente, perche' la PR non viene mai tentata.
    //
    // Nota per chi correggera': provando a cablare la chiamata e a
    // propagare il codice dell'AppException, le prime due asserzioni qui
    // sotto passano ma l'ultima no. finishFailed assembla un Report nuovo
    // con assembleFailed, che non porta la Proposal, e reportId finisce a
    // puntare a quello: il diff sparisce insieme al Report completato.
    // "Mantenendo il diff nei dati" chiede quindi qualcosa in piu' del
    // semplice instradamento verso il percorso di fallimento.
    const utente = await utentePronto(ambiente.server, "DEVELOPER");
    ambiente.scritturaGithub.openPullRequestForProposal.mockRejectedValue(
      new AppException(
        "PR_CREATION_FAILED",
        "GitHub ha rifiutato: il token non ha i permessi di scrittura",
        HttpStatus.FORBIDDEN,
      ),
    );

    const conclusa = await eseguiDocsReadme(utente);

    expect(conclusa.status).toBe("FAILED");
    expect(conclusa.error?.code).toBe("PR_CREATION_FAILED");

    // Il diff resta nei dati: e' il lavoro dell'agente, e non va perso
    // perche' l'apertura della PR e' fallita.
    const persistito = await ambiente.reportModel.findById(conclusa.reportId);
    expect(persistito?.proposal?.diffUnified).toContain("+Guida introduttiva.");
  }, 180_000);
});
