import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getQueueToken } from "@nestjs/bullmq";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { Test, TestingModule } from "@nestjs/testing";
import { Queue } from "bullmq";
import { Model } from "mongoose";
import request from "supertest";
import { App } from "supertest/types";
import { type Mock, vi } from "vitest";
import { AppModule } from "./../src/app.module";
import { AllExceptionsFilter } from "./../src/common/filters/all-exceptions.filter";
import { FRANC } from "./../src/contexts/franc.provider";
import { GithubClientService } from "./../src/github/github-client.service";
import { GithubWriteService } from "./../src/github/github-write.service";
import { Report, ReportDocument } from "./../src/reports/schemas/report.schema";
import { AgentInvocationService } from "./../src/tasks/agent-invocation.service";
import { Task, TaskDocument } from "./../src/tasks/schemas/task.schema";
import { UsageCounter, UsageCounterDocument } from "./../src/tasks/schemas/usage-counter.schema";
import { RunTaskJobData } from "./../src/tasks/task-processor";

/**
 * Shared scaffolding for integration tests.
 *
 * Mirrors the one in task-lifecycle.e2e-spec.ts, which remains the reference
 * model: it runs the real AppModule against real MongoDB and Redis and
 * replaces only the boundaries that are truly external to the system —
 * GitHub and the Python agent service. Extracted here because the tests
 * added after TI_05 are six and each rebuilt it identically;
 * task-lifecycle.e2e-spec.ts was not touched, its copy works and is the
 * reference to compare this one against.
 *
 * Must be run with the queue in exclusive mode: the AppModule registers a
 * BullMQ worker, so a development backend running on the same Redis would
 * consume these tests' jobs with the real agent service instead of the
 * mock.
 */

export const URL_REPO = "https://github.com/OWASP/NodeGoat";

/** Minimal tree structure that context validation expects from GitHub. */
export const TREE = [
  { path: "app/data/user-dao.js", type: "file" as const, sizeBytes: 2048 },
  { path: "app/routes/session.js", type: "file" as const, sizeBytes: 1024 },
];

const REPOSITORY = {
  owner: "OWASP",
  name: "NodeGoat",
  isPrivate: false,
  defaultBranch: "master",
  primaryLanguage: "JavaScript",
};

export interface GithubMock {
  verifyToken: Mock;
  listRepositories: Mock;
  getRepository: Mock;
  resolveRefToSha: Mock;
  getTree: Mock;
  getFileContent: Mock;
  getReadme: Mock;
  listRefs: Mock;
  listIssues: Mock;
  getIssueDetail: Mock;
}

/** GitHub read mock: no network, deterministic responses. */
export function githubMock(): GithubMock {
  return {
    verifyToken: vi.fn().mockResolvedValue({ scopes: ["repo"], login: "test-user" }),
    listRepositories: vi.fn().mockResolvedValue([REPOSITORY]),
    getRepository: vi.fn().mockResolvedValue(REPOSITORY),
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
}

export interface AgentMock {
  invoke: Mock;
  resume: Mock;
}

/** Agent service mock: each test decides how it should respond. */
export function agentMock(): AgentMock {
  return { invoke: vi.fn(), resume: vi.fn() };
}

export interface GithubWriteMock {
  openPullRequestForProposal: Mock;
}

export interface E2EEnvironment {
  app: INestApplication<App>;
  server: App;
  github: GithubMock;
  agent: AgentMock;
  githubWrite: GithubWriteMock;
  queue: Queue<RunTaskJobData>;
  taskModel: Model<TaskDocument>;
  reportModel: Model<ReportDocument>;
  usageModel: Model<UsageCounterDocument>;
  close: () => Promise<void>;
}

export interface EnvironmentOptions {
  /** Also replaces GithubWriteService, for tests on PR opening. */
  withGithubWrite?: boolean;
  /**
   * Keeps the real AgentInvocationService, replacing the boundary further
   * down: the HTTP call to the agent service. Useful for tests that need
   * to exercise the translation between the agent response and the task
   * outcome — replacing the service would skip it along with the rest.
   */
  withRealAgent?: boolean;
  /**
   * Keeps the real GithubClientService, i.e. real calls to the GitHub API.
   * Only for tests that verify that specific boundary, and only with a
   * valid token available.
   */
  withRealGithub?: boolean;
}

/**
 * Starts the real application with the two external boundaries replaced.
 *
 * The pipe and filter settings are the same as main.ts: without the pipe
 * DTOs would not be validated, without the filter the error body would not
 * carry the `code` field that these tests assert on.
 */
export async function startEnvironment(options: EnvironmentOptions = {}): Promise<E2EEnvironment> {
  const github = githubMock();
  const agent = agentMock();
  const githubWrite: GithubWriteMock = {
    openPullRequestForProposal: vi.fn(),
  };

  let builder = Test.createTestingModule({ imports: [AppModule] })
    // franc-min is ESM-only and is resolved with a dynamic import(), which
    // Jest cannot run without --experimental-vm-modules (as stated in the
    // comment in franc.provider.ts). It is a third-party library for
    // language detection: replacing it does not affect the logic under test.
    .overrideProvider(FRANC)
    .useValue(() => "eng");

  if (!options.withRealGithub) {
    builder = builder.overrideProvider(GithubClientService).useValue(github);
  }

  if (!options.withRealAgent) {
    builder = builder.overrideProvider(AgentInvocationService).useValue(agent);
  }

  if (options.withGithubWrite) {
    builder = builder.overrideProvider(GithubWriteService).useValue(githubWrite);
  }

  const module: TestingModule = await builder.compile();

  const app = module.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix("api/v1");
  await app.init();

  return {
    app,
    server: app.getHttpServer(),
    github,
    agent,
    githubWrite,
    queue: app.get<Queue<RunTaskJobData>>(getQueueToken("tasks")),
    taskModel: app.get<Model<TaskDocument>>(getModelToken(Task.name)),
    reportModel: app.get<Model<ReportDocument>>(getModelToken(Report.name)),
    usageModel: app.get<Model<UsageCounterDocument>>(getModelToken(UsageCounter.name)),
    close: () => app.close(),
  };
}

export interface TestUser {
  token: string;
  userId: string;
  email: string;
}

/** Registers a new user and opens a session. */
export async function authenticatedUser(
  server: App,
  role = "SECURITY_AUDITOR",
): Promise<TestUser> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const password = "test-password-123";

  const registration = await request(server)
    .post("/api/v1/auth/register")
    .send({ firstName: "Ada", lastName: "Lovelace", email, password, role })
    .expect(201);

  const login = await request(server)
    .post("/api/v1/auth/login")
    .send({ email, password })
    .expect(200);

  return {
    token: login.body.accessToken as string,
    userId: registration.body.id as string,
    email,
  };
}

/** Saves the GitHub credential that every operation requires. */
export async function saveCredential(server: App, token: string): Promise<void> {
  await request(server)
    .post("/api/v1/credentials")
    .set("Authorization", `Bearer ${token}`)
    .send({ provider: "GITHUB", token: "ghp_test_token_0123456789" })
    .expect(201);
}

/** Creates an analysis context on the entire repository. */
export async function createContext(server: App, token: string): Promise<string> {
  const response = await request(server)
    .post("/api/v1/contexts")
    .set("Authorization", `Bearer ${token}`)
    .send({ repoUrl: URL_REPO, branch: "master", scopeType: "FULL_REPOSITORY" })
    .expect(201);

  return response.body.id as string;
}

/** Authenticated user, with credential and context already set up. */
export async function readyUser(
  server: App,
  role = "SECURITY_AUDITOR",
): Promise<TestUser & { contextId: string }> {
  const user = await authenticatedUser(server, role);
  await saveCredential(server, user.token);
  const contextId = await createContext(server, user.token);
  return { ...user, contextId };
}

/**
 * Waits for a task to reach a terminal state.
 *
 * The BullMQ worker registered by the AppModule consumes the queue on its
 * own: the test must not invoke the processor manually — it would race
 * with it — but observe the outcome of the real path.
 */
export async function waitForOutcome(
  taskModel: Model<TaskDocument>,
  taskId: string,
  timeoutMs = 20_000,
): Promise<TaskDocument> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await taskModel.findById(taskId);
    if (task && ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) {
      return task;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Task ${taskId} did not reach a terminal state within ${timeoutMs}ms`);
}

/** Waits for a condition to be met, for non-terminal waits. */
export async function waitForCondition(
  condition: () => Promise<boolean>,
  description: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms: ${description}`);
}

/**
 * Reads a variable from `Src/MVP/.env`, which Jest does not load on its own.
 *
 * That file collects the variables for tests against real services
 * (`E2E_GITHUB_PAT` and similar) and is already used by the Playwright suite;
 * integration tests that touch GitHub read from here instead of requiring
 * the operator to export them manually before each run.
 * A variable already present in the environment takes precedence anyway.
 */
export function fromMonorepoEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const content = readFileSync(resolve(__dirname, "..", "..", ".env"), "utf8");
    const line = content.split("\n").find((r) => r.trim().startsWith(`${key}=`));
    return line?.slice(line.indexOf("=") + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}
