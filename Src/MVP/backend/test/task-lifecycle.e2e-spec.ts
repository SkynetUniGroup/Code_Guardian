import { INestApplication, ValidationPipe } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { Test, TestingModule } from "@nestjs/testing";
import { Model } from "mongoose";
import request from "supertest";
import { App } from "supertest/types";
import { vi } from "vitest";
import { AppModule } from "./../src/app.module";
import { FRANC } from "./../src/contexts/franc.provider";
import { GithubClientService } from "./../src/github/github-client.service";
import { Report, ReportDocument } from "./../src/reports/schemas/report.schema";
import { AgentInvocationService } from "./../src/tasks/agent-invocation.service";
import { Task, TaskDocument } from "./../src/tasks/schemas/task.schema";

/**
 * TI_05 (Test Plan) — full task lifecycle against the real application
 * stack.
 *
 * Runs the real AppModule against a real MongoDB and a real Redis (those
 * from `docker compose up -d mongodb redis`). Only the two boundaries that
 * are truly external to the system are replaced: GitHub and the Python
 * agent service. Everything else — validation, guards, persistence,
 * Orchestrator routing, Report assembly — is production code.
 *
 * Verified path: registration -> credential -> context -> task ->
 * routing to the agent -> execution -> Report persisted and readable.
 *
 * Must be run with the queue in exclusive mode: the AppModule registers a
 * BullMQ worker, so a development backend running on the same Redis would
 * consume this test's jobs with the real agent service instead of the
 * mock, and the invocation assertions would fail. Stop
 * `npm run start:dev` before running it; in CI the issue does not arise.
 */

const REPO_URL = "https://github.com/OWASP/NodeGoat";

/** Minimal tree structure that the context resolver expects from GitHub. */
const TREE = [
  { path: "app/data/user-dao.js", type: "file" as const, sizeBytes: 2048 },
  { path: "app/routes/session.js", type: "file" as const, sizeBytes: 1024 },
];

describe("TI_05 — task lifecycle (real stack)", () => {
  let app: INestApplication<App>;
  let server: App;
  let taskModel: Model<TaskDocument>;
  let reportModel: Model<ReportDocument>;

  /** Agent service mock: responds as a successful agent would. */
  const agent = {
    invoke: vi.fn(),
    resume: vi.fn(),
  };

  /** GitHub mock: no network calls, deterministic responses. */
  const github = {
    verifyToken: vi.fn().mockResolvedValue({ scopes: ["repo"], login: "test-user" }),
    listRepositories: vi.fn().mockResolvedValue([
      {
        owner: "OWASP",
        name: "NodeGoat",
        isPrivate: false,
        defaultBranch: "master",
        primaryLanguage: "JavaScript",
      },
    ]),
    getRepository: vi.fn().mockResolvedValue({
      owner: "OWASP",
      name: "NodeGoat",
      isPrivate: false,
      defaultBranch: "master",
      primaryLanguage: "JavaScript",
    }),
    resolveRefToSha: vi.fn().mockResolvedValue("abc1234567890"),
    getTree: vi.fn().mockResolvedValue(TREE),
    getFileContent: vi.fn().mockResolvedValue({
      path: "app/data/user-dao.js",
      content: "function login() {}",
      sha: "file-sha",
      language: "JavaScript",
    }),
    getReadme: vi.fn().mockResolvedValue(null),
    listRefs: vi.fn().mockResolvedValue({
      branches: [{ name: "master", sha: "abc1234567890" }],
      tags: [],
    }),
    listIssues: vi.fn().mockResolvedValue([]),
    getIssueDetail: vi.fn(),
  };

  /** Registers a user and opens a session, returning the token. */
  async function authenticatedUser(role = "SECURITY_AUDITOR") {
    const email = `ti05-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
    const password = "test-password-123";
    await request(server)
      .post("/api/v1/auth/register")
      .send({ firstName: "Ada", lastName: "Lovelace", email, password, role })
      .expect(201);

    const login = await request(server)
      .post("/api/v1/auth/login")
      .send({ email, password })
      .expect(200);

    return login.body.accessToken as string;
  }

  /**
   * Waits for the task to reach a terminal state.
   *
   * The BullMQ worker registered by the AppModule consumes the queue on its
   * own: the test must not invoke the processor manually — it would race
   * with it — but observe the outcome of the real path.
   */
  async function waitForOutcome(taskId: string, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const task = await taskModel.findById(taskId);
      if (task && ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return task;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Task ${taskId} did not reach a terminal state within ${timeoutMs}ms`);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GithubClientService)
      .useValue(github)
      .overrideProvider(AgentInvocationService)
      .useValue(agent)
      // franc-min is ESM-only and is resolved with a dynamic import(),
      // which Jest cannot run without --experimental-vm-modules (as stated
      // in the comment in franc.provider.ts). It is a third-party library
      // for language detection: replacing it does not affect the logic
      // under test.
      .overrideProvider(FRANC)
      .useValue(() => "eng")
      .compile();

    app = moduleFixture.createNestApplication();
    // The same settings as main.ts: without them, DTOs would not be
    // validated and the test would not exercise the real contract.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix("api/v1");
    await app.init();

    server = app.getHttpServer();
    taskModel = app.get<Model<TaskDocument>>(getModelToken(Task.name));
    reportModel = app.get<Model<ReportDocument>>(getModelToken(Report.name));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    agent.invoke.mockReset();
    agent.resume.mockReset();
  });

  it("brings a task from creation to persisted Report", async () => {
    const token = await authenticatedUser();

    // 1. Credential: the backend verifies it against GitHub before saving.
    await request(server)
      .post("/api/v1/credentials")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: "GITHUB", token: "ghp_test_token_0123456789" })
      .expect(201);

    // 2. Analysis context.
    const context = await request(server)
      .post("/api/v1/contexts")
      .set("Authorization", `Bearer ${token}`)
      .send({ repoUrl: REPO_URL, branch: "master", scopeType: "FULL_REPOSITORY" })
      .expect(201);

    expect(context.body.id).toBeDefined();
    expect(context.body.resolvedSha).toBe("abc1234567890");

    // 3. Task start: the Orchestrator routes the operation.
    // The shape is that of AgentInvocationResult, the contract the
    // service exposes to the processor, not the raw HTTP response
    // of the agent that the service itself translates.
    agent.invoke.mockResolvedValue({
      status: "COMPLETED",
      payload: {
        body: [
          {
            kind: "FINDING",
            category: "A03:2021 Injection",
            severity: "HIGH",
            filePath: "app/data/user-dao.js",
            lineStart: 12,
            lineEnd: 14,
            description: "Query built by string concatenation.",
            remediation: { kind: "TEXT", text: "Use parameterized queries." },
          },
        ],
        summary: "Found 1 vulnerability.",
        tokensConsumed: 350,
      },
    });

    const start = await request(server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ contextId: context.body.id, operations: ["SECURITY_OWASP"] })
      .expect(202);

    const [taskId] = start.body.taskIds;
    expect(taskId).toBeDefined();

    // 4. The task is persisted on Mongo, associated with the requested operation.
    const saved = await taskModel.findById(taskId);
    expect(saved).not.toBeNull();
    expect(saved!.operation).toBe("SECURITY_OWASP");

    // 5. Execution: the queue worker picks up the task.
    const completed = await waitForOutcome(taskId);

    // 6. The agent was called exactly once, for that task.
    expect(agent.invoke).toHaveBeenCalledTimes(1);

    // 7. The task is completed and the Report is persisted.
    // The error is included in the comparison: a failure here is much
    // faster to diagnose knowing *what* went wrong.
    expect({ status: completed.status, error: completed.error }).toMatchObject({
      status: "COMPLETED",
    });
    expect(completed.reportId).toBeDefined();

    const savedReport = await reportModel.findById(completed.reportId);
    expect(savedReport).not.toBeNull();

    // 8. The Report is readable from the API, by its owner.
    const read = await request(server)
      .get(`/api/v1/reports/${completed.reportId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(read.body.operation).toBe("SECURITY_OWASP");
    expect(read.body.status).toBe("COMPLETED");
    expect(read.body.body).toHaveLength(1);
  }, 120_000);

  it("an agent failure produces a FAILED Report, not a silent error", async () => {
    const token = await authenticatedUser();
    await request(server)
      .post("/api/v1/credentials")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: "GITHUB", token: "ghp_test_token_0123456789" })
      .expect(201);
    const context = await request(server)
      .post("/api/v1/contexts")
      .set("Authorization", `Bearer ${token}`)
      .send({ repoUrl: REPO_URL, branch: "master", scopeType: "FULL_REPOSITORY" })
      .expect(201);

    agent.invoke.mockResolvedValue({
      status: "FAILED",
      error: { code: "TIMEOUT", message: "no response from the model", stage: "invoke_llm" },
    });

    const start = await request(server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ contextId: context.body.id, operations: ["SECURITY_OWASP"] })
      .expect(202);
    const [taskId] = start.body.taskIds;

    const completed = await waitForOutcome(taskId);

    expect(completed.status).toBe("FAILED");
    expect(completed.error).toBeDefined();
  }, 120_000);

  it("another user's report is not readable", async () => {
    const owner = await authenticatedUser();
    const stranger = await authenticatedUser();
    await request(server)
      .post("/api/v1/credentials")
      .set("Authorization", `Bearer ${owner}`)
      .send({ provider: "GITHUB", token: "ghp_test_token_0123456789" })
      .expect(201);
    const context = await request(server)
      .post("/api/v1/contexts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ repoUrl: REPO_URL, branch: "master", scopeType: "FULL_REPOSITORY" })
      .expect(201);
    agent.invoke.mockResolvedValue({
      status: "COMPLETED",
      payload: { body: [], summary: "ok" },
    });
    const start = await request(server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${owner}`)
      .send({ contextId: context.body.id, operations: ["SECURITY_OWASP"] })
      .expect(202);
    const completed = await waitForOutcome(start.body.taskIds[0]);

    await request(server)
      .get(`/api/v1/reports/${completed.reportId}`)
      .set("Authorization", `Bearer ${stranger}`)
      .expect(404);
  }, 120_000);
});
