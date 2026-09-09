import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { AppException } from "../common/exceptions/app.exception";
import type { ErrorKind } from "../common/exceptions/error-kind";
import {
  AnalysisContext,
  AnalysisContextDocument,
} from "../contexts/schemas/analysis-context.schema";
import { CredentialsService } from "../credentials/credentials.service";
import { GithubWriteService } from "../github/github-write.service";
import { AgentRegistry } from "../operations/agent-registry.service";
import { AgentRunPayload } from "./agent-client.types";
import { TaskDocument } from "./schemas/task.schema";

const GITHUB_PROVIDER = "GITHUB";

// L'anello che mancava fra l'agente Docs e GitHub.
//
// L'agente produce una Proposal (targetPath + diff unificato) e lascia
// `pullRequestUrl` a null, con l'idea che sia il backend ad aprire la PR:
// GithubWriteService fa esattamente questo ed era gia' scritto, registrato ed
// esportato — ma nessuno lo iniettava. Il risultato era che la descrizione
// dell'operazione ("apre una Pull Request con le modifiche proposte") non era
// mai vera, il pulsante "Vedi PR" del frontend non compariva mai, e l'utente si
// ritrovava un diff da applicare a mano.
//
// Sta in TasksModule e non in ReportsModule perche' e' un passo
// dell'*esecuzione* del task, non dell'assemblaggio del report: succede prima
// che il Report esista, e il suo esito (l'URL della PR) e' uno dei dati che
// finiscono nel Report.
@Injectable()
export class ProposalPublisherService {
  private readonly logger = new Logger(ProposalPublisherService.name);

  constructor(
    @InjectModel(AnalysisContext.name)
    private readonly contextModel: Model<AnalysisContextDocument>,
    private readonly credentials: CredentialsService,
    private readonly githubWrite: GithubWriteService,
    private readonly agentRegistry: AgentRegistry,
  ) {}

  // Restituisce il payload con `proposal.pullRequestUrl` valorizzato quando la
  // PR e' stata aperta, e con `proposal.pullRequestError` valorizzato quando
  // l'apertura e' fallita.
  //
  // Non solleva mai: un fallimento nell'apertura della PR non deve far fallire
  // il Task. Il lavoro dell'agente e' comunque completo e vale la pena
  // consegnarlo — il diff resta nel report, visibile ed esportabile, e
  // l'utente puo' applicarlo a mano. Trasformare questo in un Task FAILED
  // butterebbe via un'analisi riuscita per un problema di permessi su GitHub.
  //
  // Non sollevare pero' non vuol dire tacere: RF.72 chiede che
  // PR_CREATION_FAILED sia *osservabile*, e un logger.warn non lo e' per chi
  // guarda il report. L'errore viaggia percio' dentro la Proposal, accanto al
  // diff che prende il posto del collegamento mancante: cosi' l'interfaccia
  // puo' dire perche' il pulsante "Vedi PR" non c'e', invece di limitarsi a
  // non mostrarlo.
  async publish(task: TaskDocument, payload: AgentRunPayload): Promise<AgentRunPayload> {
    const proposal = payload.proposal;
    if (!proposal || proposal.pullRequestUrl) {
      // Niente da pubblicare, o gia' pubblicata (un resume che ripassa di qui).
      return payload;
    }

    try {
      const context = await this.contextModel.findById(task.contextId);
      if (!context) {
        throw new Error(`AnalysisContext ${task.contextId.toString()} non trovato`);
      }

      const token = await this.credentials.getDecryptedToken(task.userId, GITHUB_PROVIDER);

      const pullRequestUrl = await this.githubWrite.openPullRequestForProposal(
        token,
        context.repoOwner,
        context.repoName,
        // La PR punta al branch del contesto, non al default del repository:
        // l'analisi e' stata fatta su quel branch ed e' li' che la modifica ha
        // senso.
        context.branch,
        {
          operationCode: task.operation,
          targetPath: proposal.targetPath,
          diffUnified: proposal.diffUnified,
          title: `${this.agentRegistry.getDisplayName(task.operation)} — ${proposal.targetPath}`,
        },
      );

      return { ...payload, proposal: { ...proposal, pullRequestUrl } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Non e' stato possibile aprire la Pull Request per il Task ${task.id} (${proposal.targetPath}): ${message}. Il report viene comunque prodotto, con il diff da applicare a mano.`,
      );
      return {
        ...payload,
        proposal: { ...proposal, pullRequestError: { kind: classifyKind(err), message } },
      };
    }
  }
}

// L'ErrorKind da attribuire al fallimento.
//
// GithubWriteService solleva gia' AppException con il codice giusto
// (PR_CREATION_FAILED quando e' GitHub a rifiutare, CREDENTIAL_INVALID quando
// il token non vale) e quel codice va conservato: e' l'unica cosa che
// distingue "il token non ha i permessi" da "GitHub ha risposto male", due
// problemi che l'utente risolve in modi diversi.
//
// Tutto il resto — contesto non trovato, credenziale assente, guasto di rete —
// cade su UPSTREAM, che e' la regola generale dichiarata in error-kind.ts.
function classifyKind(err: unknown): ErrorKind {
  return err instanceof AppException ? err.code : "UPSTREAM";
}
