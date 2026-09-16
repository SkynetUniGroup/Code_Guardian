import { type Mock, vi } from "vitest";
import { AgentRunPayload } from "../tasks/agent-client.types";
import { ReportAssemblyService } from "./report-assembly.service";

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    _id: "task-oid",
    id: "task1",
    userId: "user1",
    operation: "DOCS_README",
    contextId: "ctx1",
    accumulatedMs: 4200,
    ...overrides,
  };
}

// A real unified diff, newlines and all: it is not Markdown, and the
// assertions below exist to prove the sanitizing never touches it.
const DIFF = ["--- a/README.md", "+++ b/README.md", "@@ -1 +1 @@", "-a", "+b", ""].join("\n");

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    repoOwner: "SkynetUniGroup",
    repoName: "Code_Guardian",
    repoUrl: "https://github.com/SkynetUniGroup/Code_Guardian",
    branch: "main",
    resolvedSha: "abc123",
    scopeType: "FULL_REPOSITORY",
    paths: [],
    ...overrides,
  };
}

describe("ReportAssemblyService", () => {
  let service: ReportAssemblyService;
  let reportModel: { create: Mock; deleteOne: Mock };
  let contextModel: { findById: Mock };
  let agentRegistry: { getDisplayName: Mock };

  beforeEach(() => {
    reportModel = {
      create: vi.fn().mockResolvedValue({ id: "report1" }),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    contextModel = { findById: vi.fn() };
    agentRegistry = {
      getDisplayName: vi.fn().mockReturnValue("README generation/update"),
    };
    service = new ReportAssemblyService(
      reportModel as never,
      contextModel as never,
      agentRegistry as never,
    );
  });

  describe("assembleCompleted", () => {
    it("denormalizes the context, composes a deterministic title, and persists the sanitized body", async () => {
      contextModel.findById.mockResolvedValue(makeContext());
      const payload: AgentRunPayload = {
        body: [{ kind: "TEXT", markdown: "<b>hi</b>" }],
        summary: "all good",
        tokensConsumed: 100,
      };

      await service.assembleCompleted(makeTask() as never, payload);

      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-oid",
          userId: "user1",
          operation: "DOCS_README",
          status: "COMPLETED",
          title: "README generation/update — SkynetUniGroup/Code_Guardian@main",
          summary: "all good",
          durationMs: 4200,
          tokensConsumed: 100,
          context: {
            repoOwner: "SkynetUniGroup",
            repoName: "Code_Guardian",
            repoUrl: "https://github.com/SkynetUniGroup/Code_Guardian",
            branch: "main",
            resolvedSha: "abc123",
            scopeType: "FULL_REPOSITORY",
            paths: [],
          },
          body: [{ kind: "TEXT", markdown: "hi" }],
        }),
      );
    });

    it("defaults summary to null when the agent did not provide one", async () => {
      contextModel.findById.mockResolvedValue(makeContext());

      await service.assembleCompleted(makeTask() as never, { body: [] });

      expect(reportModel.create).toHaveBeenCalledWith(expect.objectContaining({ summary: null }));
    });

    it("carries the proposal through unsanitized (a diff, not Markdown)", async () => {
      contextModel.findById.mockResolvedValue(makeContext());
      const proposal = {
        targetPath: "README.md",
        diffUnified: "--- a\n+++ b\n",
        language: "markdown",
        pullRequestUrl: null,
      };

      await service.assembleCompleted(makeTask() as never, {
        body: [],
        proposal,
      });

      expect(reportModel.create).toHaveBeenCalledWith(expect.objectContaining({ proposal }));
    });

    it("throws when the AnalysisContext no longer exists", async () => {
      contextModel.findById.mockResolvedValue(null);

      await expect(service.assembleCompleted(makeTask() as never, { body: [] })).rejects.toThrow(
        "AnalysisContext",
      );
      expect(reportModel.create).not.toHaveBeenCalled();
    });
  });

  describe("what the agent writes, at the boundary", () => {
    // BE-18 puts the sanitizing at the boundary so that screen and PDF
    // consume the same string. `body` went through it from the start; these
    // two crossed the same boundary from the same agent and did not.
    it("sanitizes the summary", async () => {
      contextModel.findById.mockResolvedValue(makeContext());

      await service.assembleCompleted(makeTask() as never, {
        body: [],
        summary: "vedi [qui](javascript:alert(1)) e <script>alert(2)</script>",
      });

      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ summary: "vedi qui e alert(2)" }),
      );
    });

    it('leaves a null summary null rather than sanitizing the string "null"', async () => {
      contextModel.findById.mockResolvedValue(makeContext());

      await service.assembleCompleted(makeTask() as never, { body: [] });

      expect(reportModel.create).toHaveBeenCalledWith(expect.objectContaining({ summary: null }));
    });

    it("drops a pullRequestUrl the allowlist rejects, keeping the rest of the proposal", async () => {
      // The one field of Proposal a frontend renders as a link. diffUnified
      // is not Markdown and must survive byte for byte.
      contextModel.findById.mockResolvedValue(makeContext());

      await service.assembleCompleted(makeTask() as never, {
        body: [],
        proposal: {
          targetPath: "README.md",
          diffUnified: DIFF,
          language: "markdown",
          pullRequestUrl: "javascript:alert(1)",
        },
      });

      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          proposal: {
            targetPath: "README.md",
            diffUnified: DIFF,
            language: "markdown",
            pullRequestUrl: null,
          },
        }),
      );
    });

    it("keeps an https pullRequestUrl untouched", async () => {
      contextModel.findById.mockResolvedValue(makeContext());

      await service.assembleCompleted(makeTask() as never, {
        body: [],
        proposal: {
          targetPath: "README.md",
          diffUnified: "",
          language: "markdown",
          pullRequestUrl: "https://github.com/o/r/pull/1",
        },
      });

      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          proposal: {
            targetPath: "README.md",
            diffUnified: "",
            language: "markdown",
            pullRequestUrl: "https://github.com/o/r/pull/1",
          },
        }),
      );
    });

    it("leaves an absent proposal absent", async () => {
      contextModel.findById.mockResolvedValue(makeContext());

      await service.assembleCompleted(makeTask() as never, { body: [] });

      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ proposal: undefined }),
      );
    });
  });

  describe("assembleFailed", () => {
    it("persists an empty body, null summary/durationMs, and the mapped error — title still present", async () => {
      contextModel.findById.mockResolvedValue(makeContext());
      const error = {
        code: "UPSTREAM" as const,
        message: "boom",
        stage: "EXECUTION",
      };

      await service.assembleFailed(makeTask() as never, error);

      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "FAILED",
          title: "README generation/update — SkynetUniGroup/Code_Guardian@main",
          summary: null,
          durationMs: null,
          body: [],
          error: { kind: "UPSTREAM", message: "boom", stage: "EXECUTION" },
        }),
      );
    });
  });
  /**
   * TU_23 (RF.51) — il titolo del Report è deterministico e non passa dal
   * modello.
   *
   * Il caso singolo è già coperto sopra, per COMPLETED e per FAILED. Qui si
   * chiude la formulazione del Piano di Qualifica sulle due parti che
   * restavano scoperte: che valga per tutti e sette gli OperationCode, e che
   * a comporlo non intervenga mai l'LLM.
   */
  describe("TU_23 — titolo deterministico per ogni operazione", () => {
    /** I sette codici dell'MVP con il nome che AgentRegistry espone. */
    const operazioni = [
      ["DOCS_README", "README generation/update"],
      ["DOCS_INLINE", "Inline documentation (JSDoc)"],
      ["DOCS_API", "API documentation"],
      ["SECURITY_OWASP", "OWASP Top 10 vulnerability scan"],
      ["SECURITY_POLICY", "Policy-as-code compliance check"],
      ["CHANGELOG_TECHNICAL", "Technical changelog"],
      ["CHANGELOG_BUSINESS", "Business changelog"],
    ] as const;

    it.each(operazioni)("%s compone «nome — owner/repo@branch»", async (codice, nome) => {
      contextModel.findById.mockResolvedValue(makeContext());
      agentRegistry.getDisplayName.mockReturnValue(nome);

      await service.assembleCompleted(makeTask({ operation: codice }) as never, {
        body: [],
        summary: null,
        tokensConsumed: 0,
      });

      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: codice,
          title: `${nome} — SkynetUniGroup/Code_Guardian@main`,
        }),
      );
      // Il nome dell'operazione non è una stringa incollata qui: viene chiesto
      // al registro, che è l'unico posto dove i sette codici sono definiti.
      expect(agentRegistry.getDisplayName).toHaveBeenCalledWith(codice);
    });

    it("lo stesso Task produce due volte lo stesso titolo", async () => {
      // "Deterministico" vuol dire questo e si verifica così: due assemblaggi
      // identici non possono divergere. Se il titolo passasse dal modello,
      // due invocazioni darebbero quasi certamente due stringhe diverse.
      contextModel.findById.mockResolvedValue(makeContext());
      const payload = { body: [], summary: null, tokensConsumed: 0 };

      await service.assembleCompleted(makeTask() as never, payload);
      await service.assembleCompleted(makeTask() as never, payload);

      const [primo, secondo] = reportModel.create.mock.calls;
      expect(primo[0].title).toBe(secondo[0].title);
    });

    it("il titolo si costruisce dal contesto, non dal contenuto prodotto dall'agente", async () => {
      // Il corpo e il riassunto arrivano dal modello. Cambiarli non deve
      // spostare di un carattere il titolo: è la garanzia che RF.51 chiede,
      // e il motivo per cui un Report FAILED — che di corpo non ne ha — resta
      // ugualmente identificabile in elenco.
      contextModel.findById.mockResolvedValue(makeContext());

      await service.assembleCompleted(makeTask() as never, {
        body: [{ kind: "TEXT", markdown: "un contenuto" }],
        summary: "un riassunto",
        tokensConsumed: 999,
      });
      await service.assembleCompleted(makeTask() as never, {
        body: [],
        summary: null,
        tokensConsumed: 0,
      });

      const [conContenuto, senzaContenuto] = reportModel.create.mock.calls;
      expect(conContenuto[0].title).toBe(senzaContenuto[0].title);
    });

    it("un repository diverso dà un titolo diverso", async () => {
      // Il complemento: deterministico non vuol dire costante. Le tre parti
      // variabili del formato — owner, repo, branch — devono comparire.
      contextModel.findById.mockResolvedValue(
        makeContext({ repoOwner: "OWASP", repoName: "NodeGoat", branch: "master" }),
      );

      await service.assembleCompleted(makeTask() as never, {
        body: [],
        summary: null,
        tokensConsumed: 0,
      });

      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "README generation/update — OWASP/NodeGoat@master",
        }),
      );
    });
  });

  describe("discard", () => {
    it("deletes exactly the Report it is given, by _id", async () => {
      // Never a query by taskId: a Task legitimately re-run ("Riprova"
      // creates a new Task, but a paused/resumed one does not) can have more
      // than one Report against it, and only the row this invocation created
      // is orphaned.
      await service.discard({ _id: "report-oid" } as never);

      expect(reportModel.deleteOne).toHaveBeenCalledWith({
        _id: "report-oid",
      });
      expect(reportModel.deleteOne).toHaveBeenCalledTimes(1);
    });

    it("lets a delete failure surface to the caller", async () => {
      // The swallow belongs to TaskProcessor, which knows the job must not
      // fail over it; this method stays honest about what happened so a
      // different caller could decide differently.
      reportModel.deleteOne.mockRejectedValue(new Error("mongo down"));

      await expect(service.discard({ _id: "report-oid" } as never)).rejects.toThrow("mongo down");
    });
  });
});
