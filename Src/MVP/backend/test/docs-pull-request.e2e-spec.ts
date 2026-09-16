import { HttpStatus } from "@nestjs/common";
import request from "supertest";
import { AppException } from "./../src/common/exceptions/app.exception";
import { TaskDocument } from "./../src/tasks/schemas/task.schema";
import { E2EEnvironment, waitForOutcome, startEnvironment, readyUser } from "./e2e-helpers";

/**
 * TI_12 (RF.82, RF.63) and TI_13 (RF.72) — automatic Pull Request opening
 * from the agent's Proposal.
 *
 * The two cases are in the same file because they concern the same missing
 * link, and it is worth seeing them side by side.
 *
 * The defect that this file documented — the backend did not open any Pull
 * Request, because `openPullRequestForProposal` was not called from any
 * point in the production code — on this basis no longer exists:
 * ProposalPublisherService closes the loop, and the two TI_12 cases are
 * normal tests. Only TI_13 remains open, marked `it.fails` at the bottom:
 * GitHub rejection does not yet bring the task to FAILED with
 * PR_CREATION_FAILED.
 *
 * Consequently RF.72 is not observable: `PR_CREATION_FAILED` is declared
 * in ErrorKind and raised by GithubWriteService, but no task can receive
 * it, because no task calls that method.
 *
 * What instead works — the Proposal crossing the boundary, being sanitized
 * and persisted in the Report — is verified by the tests that pass above:
 * they also serve to ensure that the `it.failing` below fail because of
 * the defect and not because of a broken scaffolding.
 *
 * Distinct from the already known defect on the Report body not crossing
 * the agent/frontend boundary: that concerns block field names and is
 * assigned to others. Here the call itself is missing.
 */
describe("TI_12 (RF.82, RF.63) / TI_13 (RF.72) — automatic Pull Request opening", () => {
  let env: E2EEnvironment;

  const PROPOSAL = {
    targetPath: "README.md",
    diffUnified:
      "--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # NodeGoat\n+Introductory guide.\n",
    language: "markdown",
    pullRequestUrl: null as string | null,
  };

  /** Runs a DOCS_README whose agent returns the given Proposal. */
  async function runDocsReadme(
    user: { token: string; contextId: string },
    proposal: typeof PROPOSAL = PROPOSAL,
  ): Promise<TaskDocument> {
    env.agent.invoke.mockResolvedValue({
      status: "COMPLETED",
      payload: {
        body: [
          {
            kind: "TEXT",
            markdown: "README updated with the introductory guide.",
          },
        ],
        proposal: proposal,
        summary: "Proposed a change to the README.",
        tokensConsumed: 220,
      },
    });

    const start = await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ contextId: user.contextId, operations: ["DOCS_README"] })
      .expect(202);

    return waitForOutcome(env.taskModel, start.body.taskIds[0] as string);
  }

  /** The Report read from the API, as the interface sees it. */
  async function reportRead(token: string, reportId: unknown) {
    const response = await request(env.server)
      .get(`/api/v1/reports/${String(reportId)}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return response.body;
  }

  beforeAll(async () => {
    env = await startEnvironment({ withGithubWrite: true });
  }, 60_000);

  afterAll(async () => {
    await env?.close();
  });

  beforeEach(() => {
    env.agent.invoke.mockReset();
    env.agent.resume.mockReset();
    env.githubWrite.openPullRequestForProposal.mockReset();
    env.githubWrite.openPullRequestForProposal.mockResolvedValue(
      "https://github.com/OWASP/NodeGoat/pull/42",
    );
  });

  it("the agent's Proposal arrives persisted in the Report and readable via API", async () => {
    const user = await readyUser(env.server, "DEVELOPER");

    const completed = await runDocsReadme(user);

    expect(completed.status).toBe("COMPLETED");
    const report = await reportRead(user.token, completed.reportId);
    expect(report.proposal).toMatchObject({
      targetPath: "README.md",
      language: "markdown",
    });
    expect(report.proposal.diffUnified).toContain("+Introductory guide.");
  }, 180_000);

  it("an already-valued PR link survives to the API", async () => {
    // The only way today that a pullRequestUrl can appear in a Report:
    // that the agent provides it. Verifying it serves to distinguish
    // "the field does not cross the boundary" from "nobody fills it", which
    // are different defects with different fixes.
    const user = await readyUser(env.server, "DEVELOPER");

    const completed = await runDocsReadme(user, {
      ...PROPOSAL,
      pullRequestUrl: "https://github.com/OWASP/NodeGoat/pull/7",
    });

    const report = await reportRead(user.token, completed.reportId);
    expect(report.proposal.pullRequestUrl).toBe("https://github.com/OWASP/NodeGoat/pull/7");
  }, 180_000);

  it("a link with a dangerous scheme is discarded, the rest of the Proposal stays", async () => {
    const user = await readyUser(env.server, "DEVELOPER");

    const completed = await runDocsReadme(user, {
      ...PROPOSAL,
      pullRequestUrl: "javascript:alert(1)",
    });

    const report = await reportRead(user.token, completed.reportId);
    expect(report.proposal.pullRequestUrl).toBeNull();
    expect(report.proposal.targetPath).toBe("README.md");
  }, 180_000);

  it("TI_12 — upon receiving the Proposal, the backend opens the Pull Request", async () => {
    // RF.82: the PR opening must be automatic, not an action the user
    // performs elsewhere by copying the diff by hand.
    const user = await readyUser(env.server, "DEVELOPER");

    await runDocsReadme(user);

    expect(env.githubWrite.openPullRequestForProposal).toHaveBeenCalledTimes(1);
  }, 180_000);

  it("TI_12 — the Report carries the link to the PR opened by the backend", async () => {
    // RF.63: the link must be persisted in the Report, which is where the
    // user comes back to look for it later.
    const user = await readyUser(env.server, "DEVELOPER");

    const completed = await runDocsReadme(user);

    const report = await reportRead(user.token, completed.reportId);
    expect(report.proposal.pullRequestUrl).toBe("https://github.com/OWASP/NodeGoat/pull/42");
  }, 180_000);

  it.fails("TI_13 — OPEN DEFECT: GitHub rejection does not bring the task to FAILED with PR_CREATION_FAILED", async () => {
    // RF.72: the Report with the diff already exists, so the failure concerns
    // only the PR opening — and must be recognizable as such, not confused
    // with an agent failure. Today the task completes without noticing
    // anything, because the PR is never attempted.
    //
    // Note for whoever fixes this: by wiring the call and propagating the
    // AppException code, the first two assertions below pass but the last
    // does not. finishFailed assembles a new Report with assembleFailed,
    // which does not carry the Proposal, and reportId ends up pointing to
    // that: the diff disappears along with the completed Report.
    // "Keeping the diff in the data" therefore asks for something more than
    // simple routing to the failure path.
    const user = await readyUser(env.server, "DEVELOPER");
    env.githubWrite.openPullRequestForProposal.mockRejectedValue(
      new AppException(
        "PR_CREATION_FAILED",
        "GitHub refused: the token does not have write permissions",
        HttpStatus.FORBIDDEN,
      ),
    );

    const completed = await runDocsReadme(user);

    expect(completed.status).toBe("FAILED");
    expect(completed.error?.code).toBe("PR_CREATION_FAILED");

    // The diff stays in the data: it is the agent's work, and should not be
    // lost because the PR opening failed.
    const persisted = await env.reportModel.findById(completed.reportId);
    expect(persisted?.proposal?.diffUnified).toContain("+Introductory guide.");
  }, 180_000);
});
