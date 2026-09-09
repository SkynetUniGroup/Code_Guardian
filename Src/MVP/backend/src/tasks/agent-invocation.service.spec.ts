import { type Mock, vi } from "vitest";
import { AgentRunPayload } from "./agent-client.types";
import { AgentInvocationService } from "./agent-invocation.service";

interface MockTask {
  id: string;
  userId: string;
  contextId: string;
  operation: string;
  sprintId?: string;
  lgThreadId?: string;
  save: Mock;
}

function makeTask(overrides: Partial<MockTask> = {}): MockTask {
  return {
    id: "task1",
    userId: "user1",
    contextId: "ctx1",
    operation: "DOCS_README",
    lgThreadId: undefined,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("AgentInvocationService", () => {
  let service: AgentInvocationService;
  let config: { get: Mock };
  let agentRegistry: { getTimeoutS: Mock };
  let contextModel: { findById: Mock };
  let credentials: { getDecryptedSonarqubeCredential: Mock };
  let fetchMock: Mock;

  // Il contesto che invoke() denormalizza dentro context_ref del payload.
  const context = {
    repoOwner: "acme",
    repoName: "app",
    repoUrl: "https://github.com/acme/app",
    branch: "main",
    resolvedSha: "abc123",
    scopeType: "FULL_REPOSITORY",
    paths: [],
  };

  beforeEach(() => {
    config = { get: vi.fn().mockReturnValue("http://agents:8000") };
    agentRegistry = { getTimeoutS: vi.fn().mockReturnValue(90) };
    contextModel = { findById: vi.fn().mockResolvedValue(context) };
    credentials = { getDecryptedSonarqubeCredential: vi.fn().mockResolvedValue(null) };
    service = new AgentInvocationService(
      config as never,
      agentRegistry as never,
      contextModel as never,
      credentials as never,
    );
    fetchMock = vi.fn();
    global.fetch = fetchMock as never;
  });

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return { ok, status, json: () => Promise.resolve(body) };
  }

  // BE-18: a 'completed' response always needs a `result` payload (the
  // service treats one without it as a failure — see the dedicated test
  // below) — this is the minimal valid one, for tests that only care about
  // something else.
  function completedResponse(result: AgentRunPayload = { body: [] }) {
    return jsonResponse({ status: "completed", result });
  }

  it("generates and persists a threadId when the Task has none", async () => {
    const task = makeTask();
    fetchMock.mockResolvedValue(completedResponse());

    await service.invoke(task as never);

    expect(task.save).toHaveBeenCalled();
    expect(task.lgThreadId).toEqual(expect.any(String));
  });

  it("reuses an existing threadId without saving again", async () => {
    const task = makeTask({ lgThreadId: "existing-thread" });
    fetchMock.mockResolvedValue(completedResponse());

    await service.invoke(task as never);

    expect(task.save).not.toHaveBeenCalled();
    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const sentBody = JSON.parse(options.body) as { threadId: string };
    expect(sentBody.threadId).toBe("existing-thread");
  });

  it("posts taskId, operationCode and an empty payload to /internal/agent/start", async () => {
    const task = makeTask();
    fetchMock.mockResolvedValue(completedResponse());

    await service.invoke(task as never);

    const [url, options] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("http://agents:8000/internal/agent/start");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toMatchObject({
      taskId: "task1",
      operationCode: "DOCS_README",
      payload: {},
    });
  });

  it("forwards the user's SonarQube credential in the payload for DOCS operations", async () => {
    const task = makeTask({ operation: "DOCS_INLINE" });
    credentials.getDecryptedSonarqubeCredential.mockResolvedValue({
      instanceUrl: "https://sonarcloud.io",
      projectKey: "acme_app",
      token: "sonar_tok",
      organizationKey: "acme",
    });
    fetchMock.mockResolvedValue(completedResponse());

    await service.invoke(task as never);

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const sentBody = JSON.parse(options.body) as {
      payload: { sonarqube_credentials?: { projectKey: string } };
    };
    expect(sentBody.payload.sonarqube_credentials).toEqual({
      instanceUrl: "https://sonarcloud.io",
      projectKey: "acme_app",
      token: "sonar_tok",
      organizationKey: "acme",
    });
    expect(credentials.getDecryptedSonarqubeCredential).toHaveBeenCalledWith("user1");
  });

  it("omits sonarqube_credentials for non-DOCS operations and when the user has none", async () => {
    const securityTask = makeTask({ operation: "SECURITY_OWASP" });
    fetchMock.mockResolvedValue(completedResponse());

    await service.invoke(securityTask as never);

    expect(credentials.getDecryptedSonarqubeCredential).not.toHaveBeenCalled();
    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(options.body).payload).not.toHaveProperty("sonarqube_credentials");
  });

  it("still starts the task when the SonarQube credential lookup throws", async () => {
    const task = makeTask({ operation: "DOCS_README" });
    credentials.getDecryptedSonarqubeCredential.mockRejectedValue(new Error("cipher down"));
    fetchMock.mockResolvedValue(completedResponse());

    await expect(service.invoke(task as never)).resolves.toMatchObject({ status: "COMPLETED" });
    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(options.body).payload).not.toHaveProperty("sonarqube_credentials");
  });

  it("returns COMPLETED carrying the agent result payload — BE-18 needs it to assemble a Report", async () => {
    const task = makeTask();
    const payload: AgentRunPayload = {
      body: [{ kind: "TEXT", markdown: "hello" }],
      summary: "a summary",
      tokensConsumed: 42,
    };
    fetchMock.mockResolvedValue(completedResponse(payload));

    await expect(service.invoke(task as never)).resolves.toEqual({
      status: "COMPLETED",
      payload,
    });
  });

  it("fails with PARSING when the agent reports completed without a result payload", async () => {
    const task = makeTask();
    fetchMock.mockResolvedValue(jsonResponse({ status: "completed" }));

    const result = await service.invoke(task as never);

    expect(result).toMatchObject({
      status: "FAILED",
      error: { code: "PARSING" },
    });
  });

  it("maps a failed response error through the agent error mapper", async () => {
    const task = makeTask();
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "failed",
        errorKind: "RATE_LIMITED",
        error: "Rate limit exceeded",
      }),
    );

    const result = await service.invoke(task as never);

    expect(result).toEqual({
      status: "FAILED",
      error: {
        code: "LLM_RATE_LIMITED",
        message: "Rate limit exceeded",
        stage: "EXECUTION",
      },
    });
  });

  it("returns INTERRUPTED with the pendingInput the agent reported", async () => {
    const task = makeTask({ operation: "CHANGELOG_TECHNICAL" });
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "interrupted",
        pendingInput: { kind: "INCOMPLETE_TASKS", taskIds: ["T-1"] },
      }),
    );

    const result = await service.invoke(task as never);

    expect(result).toEqual({
      status: "INTERRUPTED",
      pendingInput: { kind: "INCOMPLETE_TASKS", taskIds: ["T-1"] },
    });
  });

  it("fails with PARSING when the agent reports interrupted without a pendingInput", async () => {
    const task = makeTask();
    fetchMock.mockResolvedValue(jsonResponse({ status: "interrupted" }));

    const result = await service.invoke(task as never);

    expect(result).toMatchObject({
      status: "FAILED",
      error: { code: "PARSING" },
    });
  });

  it("fails with UPSTREAM on a non-2xx HTTP response", async () => {
    const task = makeTask();
    fetchMock.mockResolvedValue(jsonResponse({}, false, 500));

    const result = await service.invoke(task as never);

    expect(result).toMatchObject({ error: { code: "UPSTREAM" } });
  });

  it("fails with UPSTREAM, not TIMEOUT, when the gateway aborts on its own deadline", async () => {
    // TIMEOUT is reserved for the agent itself reporting its model call
    // timed out — the gateway not getting a response at all is a distinct,
    // less specific failure (could be a hang, a crash, a network issue).
    const task = makeTask();
    const timeoutError = new Error("timed out");
    timeoutError.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeoutError);

    const result = await service.invoke(task as never);

    expect(result).toMatchObject({ error: { code: "UPSTREAM" } });
  });

  it("fails with TIMEOUT when the agent itself reports its model call timed out", async () => {
    // La categoria viaggia in `errorKind`, separata dal messaggio: prima
    // esisteva solo `error` e veniva usato per entrambi gli scopi, così ogni
    // fallimento dell'agente finiva mappato su UPSTREAM.
    const task = makeTask();
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "failed",
        errorKind: "TIMEOUT",
        error: "Model call timed out after 90s",
      }),
    );

    const result = await service.invoke(task as never);

    expect(result).toMatchObject({
      error: { code: "TIMEOUT", message: "Model call timed out after 90s" },
    });
  });

  it("ripiega su UPSTREAM se l'agente non classifica il fallimento", async () => {
    const task = makeTask();
    fetchMock.mockResolvedValue(jsonResponse({ status: "failed", error: "boom" }));

    const result = await service.invoke(task as never);

    expect(result).toMatchObject({ error: { code: "UPSTREAM", message: "boom" } });
  });

  it("fails with UPSTREAM on a plain network error", async () => {
    const task = makeTask();
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await service.invoke(task as never);

    // AgentInvocationResult e' una union: `error` esiste solo sul ramo FAILED.
    expect(result).toMatchObject({
      status: "FAILED",
      error: { code: "UPSTREAM", message: "ECONNREFUSED" },
    });
  });

  describe("resume", () => {
    it("posts taskId, threadId, operationCode and inputValue to /internal/agent/resume", async () => {
      const task = makeTask({
        operation: "CHANGELOG_TECHNICAL",
        lgThreadId: "existing-thread",
      });
      fetchMock.mockResolvedValue(completedResponse());

      await service.resume(task as never, { action: "PROCEED" });

      const [url, options] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
      expect(url).toBe("http://agents:8000/internal/agent/resume");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({
        taskId: "task1",
        threadId: "existing-thread",
        operationCode: "CHANGELOG_TECHNICAL",
        inputValue: { action: "PROCEED" },
      });
    });

    it("never generates a threadId — a resume with none is a caller bug, not started fresh", async () => {
      const task = makeTask({ lgThreadId: undefined });

      await expect(service.resume(task as never, { action: "PROCEED" })).rejects.toThrow(
        "no lgThreadId",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("maps a completed resume response the same way invoke() does, payload included", async () => {
      const task = makeTask({ lgThreadId: "thread1" });
      const payload: AgentRunPayload = { body: [] };
      fetchMock.mockResolvedValue(completedResponse(payload));

      await expect(service.resume(task as never, { action: "PROCEED" })).resolves.toEqual({
        status: "COMPLETED",
        payload,
      });
    });

    it("can itself return INTERRUPTED again — BUSINESS_CONFIRMATION following INCOMPLETE_TASKS", async () => {
      const task = makeTask({ lgThreadId: "thread1" });
      fetchMock.mockResolvedValue(
        jsonResponse({
          status: "interrupted",
          pendingInput: {
            kind: "BUSINESS_CONFIRMATION",
            technicalReportId: "report1",
          },
        }),
      );

      const result = await service.resume(task as never, {
        action: "PROCEED",
      });

      expect(result).toEqual({
        status: "INTERRUPTED",
        pendingInput: {
          kind: "BUSINESS_CONFIRMATION",
          technicalReportId: "report1",
        },
      });
    });
  });
});
