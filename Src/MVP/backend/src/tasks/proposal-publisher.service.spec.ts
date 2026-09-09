import { HttpStatus } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { Test, type TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { AppException } from "../common/exceptions/app.exception";
import { AnalysisContext } from "../contexts/schemas/analysis-context.schema";
import { CredentialsService } from "../credentials/credentials.service";
import { GithubWriteService } from "../github/github-write.service";
import { AgentRegistry } from "../operations/agent-registry.service";
import type { AgentRunPayload } from "./agent-client.types";
import { ProposalPublisherService } from "./proposal-publisher.service";
import type { TaskDocument } from "./schemas/task.schema";

/**
 * TI_12 / TI_13 (RF.82, RF.63, RF.72) — l'anello fra l'agente Docs e GitHub.
 *
 * Due difetti sovrapposti vivevano qui. Il primo: GithubWriteService era
 * scritto, registrato ed esportato, e non lo chiamava nessuno — l'agente
 * produceva il diff, il diff finiva nel Report, e la Pull Request non veniva
 * mai aperta. Il secondo, che si vede solo dopo aver risolto il primo:
 * PR_CREATION_FAILED restava comunque inosservabile, perche' il fallimento
 * dell'apertura veniva ingoiato in un logger.warn e nel report non ne restava
 * traccia.
 */
describe("ProposalPublisherService", () => {
  let service: ProposalPublisherService;
  let contextModel: { findById: Mock };
  let credentials: { getDecryptedToken: Mock };
  let githubWrite: { openPullRequestForProposal: Mock };

  const task = {
    id: "task1",
    userId: "user1",
    operation: "DOCS_INLINE",
    contextId: { toString: () => "ctx1" },
  } as unknown as TaskDocument;

  const payload = (): AgentRunPayload => ({
    body: [],
    proposal: {
      targetPath: "src/index.ts",
      diffUnified: "--- a/src/index.ts\n+++ b/src/index.ts\n",
      language: "typescript",
      pullRequestUrl: null,
    },
  });

  beforeEach(async () => {
    contextModel = {
      findById: vi.fn().mockResolvedValue({
        repoOwner: "owner",
        repoName: "repo",
        branch: "main",
      }),
    };
    credentials = { getDecryptedToken: vi.fn().mockResolvedValue("token") };
    githubWrite = {
      openPullRequestForProposal: vi.fn().mockResolvedValue("https://github.com/owner/repo/pull/7"),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalPublisherService,
        { provide: getModelToken(AnalysisContext.name), useValue: contextModel },
        { provide: CredentialsService, useValue: credentials },
        { provide: GithubWriteService, useValue: githubWrite },
        AgentRegistry,
      ],
    }).compile();

    service = module.get(ProposalPublisherService);
  });

  it("RF.82 — apre la Pull Request e scrive l'URL nella Proposal", async () => {
    const result = await service.publish(task, payload());

    expect(githubWrite.openPullRequestForProposal).toHaveBeenCalledWith(
      "token",
      "owner",
      "repo",
      // Il branch del contesto, non il default del repository: l'analisi e'
      // stata fatta li' ed e' li' che la modifica ha senso.
      "main",
      expect.objectContaining({ targetPath: "src/index.ts", operationCode: "DOCS_INLINE" }),
    );
    expect(result.proposal?.pullRequestUrl).toBe("https://github.com/owner/repo/pull/7");
    expect(result.proposal?.pullRequestError).toBeUndefined();
  });

  it("non fa nulla quando non c'e' una Proposal da pubblicare", async () => {
    const result = await service.publish(task, { body: [] });

    expect(githubWrite.openPullRequestForProposal).not.toHaveBeenCalled();
    expect(result.proposal).toBeUndefined();
  });

  it("non riapre una Pull Request gia' aperta", async () => {
    // Il caso e' un resume che ripassa di qui: senza questo controllo ogni
    // ripresa aprirebbe una PR in piu' per la stessa modifica.
    const already = payload();
    // biome-ignore lint/style/noNonNullAssertion: la Proposal e' appena stata costruita qui sopra.
    already.proposal!.pullRequestUrl = "https://github.com/owner/repo/pull/1";

    const result = await service.publish(task, already);

    expect(githubWrite.openPullRequestForProposal).not.toHaveBeenCalled();
    expect(result.proposal?.pullRequestUrl).toBe("https://github.com/owner/repo/pull/1");
  });

  it("RF.72 — registra PR_CREATION_FAILED nella Proposal, conservando il diff", async () => {
    githubWrite.openPullRequestForProposal.mockRejectedValue(
      new AppException(
        "PR_CREATION_FAILED",
        "GitHub refused to open the Pull Request.",
        HttpStatus.BAD_GATEWAY,
      ),
    );

    const result = await service.publish(task, payload());

    expect(result.proposal?.pullRequestUrl).toBeNull();
    expect(result.proposal?.pullRequestError).toEqual({
      kind: "PR_CREATION_FAILED",
      message: "GitHub refused to open the Pull Request.",
    });
    // Il punto della clausola: il lavoro dell'agente resta consegnabile.
    expect(result.proposal?.diffUnified).toBe(payload().proposal?.diffUnified);
  });

  it("conserva il codice quando GitHub rifiuta la credenziale", async () => {
    // PR_CREATION_FAILED e CREDENTIAL_INVALID sono due problemi che l'utente
    // risolve in modi diversi: appiattirli su un unico codice generico
    // toglierebbe l'unica informazione utile.
    githubWrite.openPullRequestForProposal.mockRejectedValue(
      new AppException("CREDENTIAL_INVALID", "Token rifiutato.", HttpStatus.UNAUTHORIZED),
    );

    const result = await service.publish(task, payload());

    expect(result.proposal?.pullRequestError?.kind).toBe("CREDENTIAL_INVALID");
  });

  it("classifica come UPSTREAM ogni fallimento non classificato", async () => {
    githubWrite.openPullRequestForProposal.mockRejectedValue(new Error("socket hang up"));

    const result = await service.publish(task, payload());

    expect(result.proposal?.pullRequestError).toEqual({
      kind: "UPSTREAM",
      message: "socket hang up",
    });
  });

  it("non solleva mai: un contesto mancante diventa un errore registrato, non un Task fallito", async () => {
    contextModel.findById.mockResolvedValue(null);

    const result = await service.publish(task, payload());

    expect(result.proposal?.pullRequestError?.kind).toBe("UPSTREAM");
    expect(result.proposal?.diffUnified).toBeTruthy();
  });
});
