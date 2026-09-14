import request from "supertest";
import { type Mock, vi } from "vitest";
import { AgentRegistry, MAX_OPERATION_TIMEOUT_S } from "./../src/operations/agent-registry.service";
import { E2EEnvironment, waitForOutcome, startEnvironment, readyUser } from "./e2e-helpers";

/**
 * TI_14 (RQ.8) — the backend half of the rate limit chain.
 *
 * Complementary to TU_26, which verifies only the mapping function, and to
 * the Python half in `agents/tests/test_ti14_rate_limit.py`, which covers
 * the upstream links. Here the question is: when the agent service responds
 * `RATE_LIMITED`, does the user actually see `error.code = LLM_RATE_LIMITED`
 * on their task and their Report, going through the real code?
 *
 * To be able to ask that, this test does **not** replace
 * AgentInvocationService — which is precisely the component that translates —
 * but the boundary further down: the HTTP call. Replacing the service would
 * skip the mapping along with the network, and the test would verify only
 * its own mock.
 *
 * Caveat on the full chain: today the agent service never emits the
 * response that this test puts in its mouth. `execute_step` returns
 * `status: 'completed'` even for a FAILED report, so the `error` field
 * stays empty and a real rate limit arrives here as a completion. The
 * defect is documented by the xfail in test_ti14_rate_limit.py; these
 * assertions describe what happens as soon as it is fixed, and verify
 * right now that the backend half is ready.
 */
describe("TI_14 (RQ.8) — agent error propagation to the task", () => {
  let env: E2EEnvironment;
  let originalFetch: typeof global.fetch;
  let httpCalls: Mock;

  /** The HTTP response that the agent service would return. */
  function agentResponse(body: unknown) {
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    };
  }

  /** Starts a single operation and waits for its outcome. */
  async function runOperation(
    user: { token: string; contextId: string },
    operation = "SECURITY_OWASP",
  ) {
    const start = await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ contextId: user.contextId, operations: [operation] })
      .expect(202);

    return waitForOutcome(env.taskModel, start.body.taskIds[0] as string);
  }

  beforeAll(async () => {
    env = await startEnvironment({ withRealAgent: true });
    originalFetch = global.fetch;
  }, 60_000);

  afterAll(async () => {
    global.fetch = originalFetch;
    await env?.close();
  });

  beforeEach(() => {
    httpCalls = vi.fn();
    global.fetch = httpCalls as never;
  });

  it("a RATE_LIMITED from the agent becomes error.code = LLM_RATE_LIMITED on the task", async () => {
    const user = await readyUser(env.server);
    httpCalls.mockResolvedValue(
      agentResponse({ status: "failed", errorKind: "RATE_LIMITED", error: "the agent failed" }),
    );

    const completed = await runOperation(user);

    expect(completed.status).toBe("FAILED");
    expect(completed.error?.code).toBe("LLM_RATE_LIMITED");
  }, 120_000);

  it("the same code reaches the Report and the API read", async () => {
    // The field that the interface actually reads: a correct error on the task
    // but absent from the Report would leave the user without explanation on
    // the page where they look for it.
    const user = await readyUser(env.server);
    httpCalls.mockResolvedValue(
      agentResponse({ status: "failed", errorKind: "RATE_LIMITED", error: "the agent failed" }),
    );

    const completed = await runOperation(user);

    const task = await request(env.server)
      .get(`/api/v1/tasks/${completed.id}`)
      .set("Authorization", `Bearer ${user.token}`)
      .expect(200);
    expect(task.body.error.code).toBe("LLM_RATE_LIMITED");

    const report = await request(env.server)
      .get(`/api/v1/reports/${completed.reportId}`)
      .set("Authorization", `Bearer ${user.token}`)
      .expect(200);
    expect(report.body.status).toBe("FAILED");
    expect(report.body.error.kind).toBe("LLM_RATE_LIMITED");
  }, 120_000);

  it.each([
    ["RATE_LIMITED", "LLM_RATE_LIMITED"],
    ["TIMEOUT", "TIMEOUT"],
    ["CONTEXT_TOO_LARGE", "CONTEXT_TOO_LARGE"],
    ["SOMETHING_NEW", "UPSTREAM"],
  ])(
    "the agent responds %s and the task reports %s",
    async (fromAgent, expected) => {
      // The full path for cases that distinguish the mapping: the
      // renamed one, two passing, and an unknown one that must fall back to
      // UPSTREAM instead of reaching the user as an invented code.
      const user = await readyUser(env.server);
      httpCalls.mockResolvedValue(
        agentResponse({ status: "failed", errorKind: fromAgent, error: "the agent failed" }),
      );

      const completed = await runOperation(user);

      expect(completed.error?.code).toBe(expected);
    },
    120_000,
  );

  it("every invocation carries a timeout: no unbounded wait", async () => {
    // "No indefinite waits" is a property of the request, not of the
    // outcome: it is verified by checking that the call starts with a
    // timeout, not by waiting 185 seconds for it to fire.
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const user = await readyUser(env.server);
    httpCalls.mockResolvedValue(
      agentResponse({ status: "failed", errorKind: "RATE_LIMITED", error: "the agent failed" }),
    );

    await runOperation(user);

    const [, options] = httpCalls.mock.calls[0] as [string, { signal?: AbortSignal }];
    expect(options.signal).toBeInstanceOf(AbortSignal);

    // The timeout is the registry one plus the network margin, not a
    // random number, and stays under the hard cap of RQ.6.
    const budget = new AgentRegistry().getTimeoutS("SECURITY_OWASP");
    expect(timeouts).toHaveBeenCalledWith((budget + 5) * 1000);
    expect(budget).toBeLessThanOrEqual(MAX_OPERATION_TIMEOUT_S);
    timeouts.mockRestore();
  }, 120_000);

  it("after the wait expires, the task fails instead of staying RUNNING forever", async () => {
    // The worst case: the agent does not respond at all. The task must
    // reach a terminal state, and it is UPSTREAM and not TIMEOUT — the
    // latter is reserved for the model declaring it timed out; here we
    // do not even know if it tried.
    const user = await readyUser(env.server);
    const timedOut = new Error("The operation was aborted due to timeout");
    timedOut.name = "TimeoutError";
    httpCalls.mockRejectedValue(timedOut);

    const completed = await runOperation(user);

    expect(completed.status).toBe("FAILED");
    expect(completed.error?.code).toBe("UPSTREAM");
    expect(completed.error?.message).toContain("timed out");
  }, 120_000);

  it("an unreachable agent still closes the task, and quickly", async () => {
    // The network drops: no 429, no response, just a connection error.
    // Here too the task must close, and the measured time is well under
    // the operation budget — i.e. the backend is not waiting for the
    // timeout to notice.
    const user = await readyUser(env.server);
    httpCalls.mockRejectedValue(new Error("ECONNREFUSED"));

    const start = Date.now();
    const completed = await runOperation(user);
    const elapsed = Date.now() - start;

    expect(completed.status).toBe("FAILED");
    expect(completed.error?.code).toBe("UPSTREAM");
    expect(elapsed).toBeLessThan(30_000);
  }, 120_000);

  it("a 5xx from the agent service does not become a silent success", async () => {
    const user = await readyUser(env.server);
    httpCalls.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    });

    const completed = await runOperation(user);

    expect(completed.status).toBe("FAILED");
    expect(completed.error?.code).toBe("UPSTREAM");
    expect(completed.error?.message).toContain("503");
  }, 120_000);
});
