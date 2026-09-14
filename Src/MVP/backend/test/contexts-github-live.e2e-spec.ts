import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { E2EEnvironment, startEnvironment, authenticatedUser } from "./e2e-helpers";

/**
 * TI_06 (RF.19, 20, 22, 25, 30, RV.3) — context validation against a
 * real GitHub repository.
 *
 * The only test in this suite that actually talks to GitHub. All the others
 * replace that boundary, and rightly so: here instead the boundary *is*
 * the subject of the verification. A mock of GithubClientService would only
 * say that the service behaves like the mock we wrote around it, and would
 * never catch the case that TI_06 exists to catch — a real GitHub response
 * different from what we expected.
 *
 * It self-skips without a token: `E2E_GITHUB_PAT` is in `Src/MVP/.env`
 * (already used by the Playwright suite) and is read from there, because
 * Jest does not load that file. No writes, no credit consumption: only
 * read calls to the public API, on the same repository that the fixtures
 * of the other tests already name.
 *
 * The repository is configurable with E2E_REPO_URL / E2E_REPO_BRANCH for
 * when the Proponent will provide one of their own.
 */

/** Reads a variable from Src/MVP/.env, which Jest does not load on its own. */
function fromMonorepoEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const content = readFileSync(resolve(__dirname, "..", "..", ".env"), "utf8");
    const line = content.split("\n").find((r) => r.trim().startsWith(`${key}=`));
    return line?.slice(line.indexOf("=") + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}

const PAT = fromMonorepoEnv("E2E_GITHUB_PAT");
const URL_REPO = process.env.E2E_REPO_URL ?? "https://github.com/OWASP/NodeGoat";
const BRANCH = process.env.E2E_REPO_BRANCH ?? "master";

const describeIf = PAT ? describe : describe.skip;

describeIf("TI_06 (RF.19,20,22,25,30, RV.3) — context validation on real GitHub", () => {
  let env: E2EEnvironment;
  let token: string;

  /** POST /contexts with the given body, returning the raw response. */
  function createContext(body: Record<string, unknown>) {
    return request(env.server)
      .post("/api/v1/contexts")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  beforeAll(async () => {
    // GithubClientService is not replaced: that is the whole point of the test.
    // The agent service remains a mock — TI_06 ends at POST /contexts and
    // does not start any operation.
    env = await startEnvironment({ withRealGithub: true });

    const user = await authenticatedUser(env.server, "DEVELOPER");
    token = user.token;

    // The credential is verified against GitHub before being saved:
    // if the PAT is expired the test fails here, with a message that says
    // exactly that instead of an error further down.
    await request(env.server)
      .post("/api/v1/credentials")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: "GITHUB", token: PAT })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await env?.close();
  });

  it("success path: anchors the context to a real SHA and counts the files", async () => {
    const response = await createContext({
      repoUrl: URL_REPO,
      branch: BRANCH,
      scopeType: "FULL_REPOSITORY",
    }).expect(201);

    // A real SHA, not a placeholder: this is what makes the Report
    // reproducible even after new commits on the branch (RF.17).
    expect(response.body.resolvedSha).toMatch(/^[0-9a-f]{40}$/);
    expect(response.body.branch).toBe(BRANCH);
    expect(response.body.isPrivate).toBe(false);
    expect(response.body.estimatedFileCount).toBeGreaterThan(0);
    expect(response.body.detectedLanguages.length).toBeGreaterThan(0);
  }, 120_000);

  it("step 3 (RF.20, RV.3) — a non-existent or non-visible repository is a 404", async () => {
    // GitHub returns the same 404 for "does not exist" and for "exists but
    // this token cannot see it": the two cases are not distinguishable from
    // the API, and that is why RepoResolverService merges them into a single
    // message. This test verifies exactly that behavior in the field.
    const response = await createContext({
      repoUrl: "https://github.com/SkynetUniGroup/repository-that-does-not-exist-ti06",
      branch: "main",
      scopeType: "FULL_REPOSITORY",
    }).expect(404);

    expect(response.body.code).toBe("NOT_FOUND");
  }, 120_000);

  it("step 4 (RF.21) — a non-existent branch is a 404, and it says so", async () => {
    const response = await createContext({
      repoUrl: URL_REPO,
      branch: "branch-that-does-not-exist-ti06",
      scopeType: "FULL_REPOSITORY",
    }).expect(404);

    expect(response.body.message).toContain("branch-that-does-not-exist-ti06");
  }, 120_000);

  it("step 5 (RF.22) — a commit on the branch is accepted as anchoring", async () => {
    // First retrieve the real head of the branch, then send it back as
    // commitSha: this is the "identical" case of compareCommits, which
    // must pass.
    const first = await createContext({
      repoUrl: URL_REPO,
      branch: BRANCH,
      scopeType: "FULL_REPOSITORY",
    }).expect(201);

    const response = await createContext({
      repoUrl: URL_REPO,
      branch: BRANCH,
      commitSha: first.body.resolvedSha,
      scopeType: "FULL_REPOSITORY",
    }).expect(201);

    expect(response.body.resolvedSha).toBe(first.body.resolvedSha);
  }, 120_000);

  it("step 9 (RF.30) — a path absent from the real tree is rejected", async () => {
    const response = await createContext({
      repoUrl: URL_REPO,
      branch: BRANCH,
      scopeType: "FILES",
      paths: ["this/path/does/not/exist-ti06.ts"],
    }).expect(400);

    expect(response.body.code).toBe("VALIDATION_ERROR");
  }, 120_000);

  it("step 9 (RF.30) — a path present in the real tree is accepted", async () => {
    // The positive control of the same step: without it, "rejects everything"
    // would satisfy the previous test.
    const tree = await request(env.server)
      .get("/api/v1/repositories/tree")
      .query({ repoUrl: URL_REPO, branch: BRANCH })
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const firstFile = (tree.body.entries as { type: string; path: string }[]).find(
      (n) => n.type === "file",
    );
    expect(firstFile).toBeDefined();

    const response = await createContext({
      repoUrl: URL_REPO,
      branch: BRANCH,
      scopeType: "FILES",
      paths: [firstFile.path],
    }).expect(201);

    expect(response.body.scopeType).toBe("FILES");
    expect(response.body.estimatedFileCount).toBe(1);
  }, 120_000);
});
