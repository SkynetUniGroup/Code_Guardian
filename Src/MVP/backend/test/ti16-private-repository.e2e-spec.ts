import request from "supertest";
import {
  E2EEnvironment,
  waitForOutcome,
  startEnvironment,
  fromMonorepoEnv,
  URL_REPO,
  authenticatedUser,
} from "./e2e-helpers";

/**
 * TI_16 (RV.4) — context selection and execution on a private repository,
 * with the same outcome obtained on a public one.
 *
 * Expected status today: SKIPPED. The functionality exists in the product —
 * `RepoResolverService` reads `isPrivate` from the GitHub response and
 * carries it to the persisted context, and already distinguishes the case
 * of a private repository the token cannot see — but the fixture is
 * missing: a private test repository and a token that can see it. Until
 * the team provides one, the test declares itself skipped instead of
 * failing, as the Playwright suite does when the PAT is missing.
 *
 * Why GitHub is not replaced: RV.4 concerns exactly the boundary with
 * GitHub, i.e. whether authorization works on a non-public repository. A
 * mock would return `isPrivate: true` because we told it to, and the test
 * would verify nothing. The agent service instead remains a mock: the
 * requirement speaks of the selection and execution flow, not of analysis
 * quality, and a real model would add cost and variability without adding
 * verification.
 *
 * Why the comparison with the public repository is inside the test and not
 * left to the reader: the requirement does not say "works", it says
 * "completes successfully exactly as on a public repository". It is a
 * relative property, demonstrated by running the same flow twice and
 * comparing the outcomes, not by asserting separately on only one of the
 * two.
 *
 * To enable it, in `Src/MVP/.env`:
 *
 *   E2E_PRIVATE_REPO_URL=https://github.com/<owner>/<private-repo>
 *   E2E_PRIVATE_REPO_BRANCH=main          (optional, default "main")
 *   E2E_PRIVATE_REPO_PAT=<token>          (optional: without, uses E2E_GITHUB_PAT)
 *
 * The token must be able to see the private repository: if it cannot,
 * GitHub responds 404 as for a non-existent repository and the test fails
 * on context creation, which is the correct way to notice.
 */

const PRIVATE_URL = fromMonorepoEnv("E2E_PRIVATE_REPO_URL");
const PRIVATE_BRANCH = fromMonorepoEnv("E2E_PRIVATE_REPO_BRANCH") ?? "main";
const PAT = fromMonorepoEnv("E2E_PRIVATE_REPO_PAT") ?? fromMonorepoEnv("E2E_GITHUB_PAT");

const PUBLIC_BRANCH = "master";

const configured = Boolean(PRIVATE_URL && PAT);
const describeIf = configured ? describe : describe.skip;

describeIf("TI_16 (RV.4) — context and execution on private repository", () => {
  let env: E2EEnvironment;
  let token: string;

  /** Observable outcome of a context, to compare private and public. */
  interface ContextOutcome {
    contextId: string;
    isPrivate: boolean;
    resolvedSha: string;
    estimatedFileCount: number;
    languages: number;
  }

  async function createContext(repoUrl: string, branch: string): Promise<ContextOutcome> {
    const response = await request(env.server)
      .post("/api/v1/contexts")
      .set("Authorization", `Bearer ${token}`)
      .send({ repoUrl, branch, scopeType: "FULL_REPOSITORY" })
      .expect(201);

    return {
      contextId: response.body.id,
      isPrivate: response.body.isPrivate,
      resolvedSha: response.body.resolvedSha,
      estimatedFileCount: response.body.estimatedFileCount,
      languages: response.body.detectedLanguages.length,
    };
  }

  /** Starts an operation on the context and waits for its outcome. */
  async function runOperation(contextId: string) {
    env.agent.invoke.mockResolvedValue({
      status: "COMPLETED",
      payload: {
        body: [{ kind: "TEXT", markdown: "Analysis completed." }],
        summary: "No findings.",
        tokensConsumed: 120,
      },
    });

    const start = await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ contextId, operations: ["SECURITY_OWASP"] })
      .expect(202);

    return waitForOutcome(env.taskModel, start.body.taskIds[0] as string);
  }

  beforeAll(async () => {
    env = await startEnvironment({ withRealGithub: true });

    const user = await authenticatedUser(env.server, "SECURITY_AUDITOR");
    token = user.token;

    await request(env.server)
      .post("/api/v1/credentials")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: "GITHUB", token: PAT })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await env?.close();
  });

  beforeEach(() => {
    env.agent.invoke.mockReset();
    env.agent.resume.mockReset();
  });

  it("the context on a private repository is created and recognized as private", async () => {
    const privateCtx = await createContext(PRIVATE_URL!, PRIVATE_BRANCH);

    expect(privateCtx.isPrivate).toBe(true);
    expect(privateCtx.resolvedSha).toMatch(/^[0-9a-f]{40}$/);
    expect(privateCtx.estimatedFileCount).toBeGreaterThan(0);
  }, 180_000);

  it("a public repository remains recognized as public", async () => {
    // The positive control of the field everything else rests on: without
    // it, `isPrivate: true` would be indistinguishable from a field hardcoded
    // to true.
    const publicCtx = await createContext(URL_REPO, PUBLIC_BRANCH);

    expect(publicCtx.isPrivate).toBe(false);
  }, 180_000);

  it("the operation completes on the private repository exactly as on the public one", async () => {
    const privateCtx = await createContext(PRIVATE_URL!, PRIVATE_BRANCH);
    const publicCtx = await createContext(URL_REPO, PUBLIC_BRANCH);

    const onPrivate = await runOperation(privateCtx.contextId);
    const onPublic = await runOperation(publicCtx.contextId);

    // The outcomes are compared with each other, not with an expected
    // value written here: this is the wording of the requirement, and it
    // holds even if the flow changes for both tomorrow.
    expect({
      status: onPrivate.status,
      error: onPrivate.error,
      hasReport: Boolean(onPrivate.reportId),
    }).toEqual({
      status: onPublic.status,
      error: onPublic.error,
      hasReport: Boolean(onPublic.reportId),
    });
    expect(onPrivate.status).toBe("COMPLETED");
  }, 300_000);

  it("the Report produced on the private repository is readable by its owner", async () => {
    const privateCtx = await createContext(PRIVATE_URL!, PRIVATE_BRANCH);
    const completed = await runOperation(privateCtx.contextId);

    const report = await request(env.server)
      .get(`/api/v1/reports/${String(completed.reportId)}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(report.body.status).toBe("COMPLETED");
    expect(report.body.operation).toBe("SECURITY_OWASP");
  }, 300_000);
});
