import request from "supertest";
import { TaskDocument } from "./../src/tasks/schemas/task.schema";
import { E2EEnvironment, waitForOutcome, startEnvironment, readyUser } from "./e2e-helpers";

/**
 * TI_11 (RF.48) — tasks of the same batch are processed in isolation.
 *
 * task-processor.spec.ts verifies the same processor at the unit level,
 * one task at a time and with everything around it replaced. Here the
 * question is the one the unit test cannot ask: when three tasks born from
 * the same POST /tasks go through the same worker, the same Mongo
 * connection and the same queue, does the failure of one really leave
 * the others intact? The state that could leak the failure — the claim,
 * the Report being assembled, the error on the task — is shared at the
 * process level, not the task level.
 *
 * The expected outcome is decided by operation code, not by arrival
 * order: BullMQ does not guarantee order, and a test expecting "the
 * second one fails" would be intermittent by construction.
 */
describe("TI_11 (RF.48) — isolation among tasks of the same batch", () => {
  let env: E2EEnvironment;

  const OPERATIONS = ["DOCS_README", "DOCS_INLINE", "DOCS_API"] as const;

  /** Response of a successful agent, recognizable by the operation. */
  function successOutcome(operation: string) {
    return {
      status: "COMPLETED",
      payload: {
        body: [
          {
            kind: "TEXT",
            order: 0,
            markdown: `Outcome of ${operation}.`,
          },
        ],
        summary: `Summary of ${operation}.`,
        tokensConsumed: 100,
      },
    };
  }

  /** Starts the batch and waits for all three tasks to complete. */
  async function runBatch(token: string, contextId: string): Promise<Map<string, TaskDocument>> {
    const start = await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ contextId, operations: [...OPERATIONS] })
      .expect(202);

    const taskIds = start.body.taskIds as string[];
    expect(taskIds).toHaveLength(3);

    const completed = new Map<string, TaskDocument>();
    for (const taskId of taskIds) {
      const task = await waitForOutcome(env.taskModel, taskId);
      completed.set(task.operation, task);
    }
    return completed;
  }

  beforeAll(async () => {
    env = await startEnvironment();
  }, 60_000);

  afterAll(async () => {
    await env?.close();
  });

  beforeEach(() => {
    env.agent.invoke.mockReset();
    env.agent.resume.mockReset();
  });

  it("the failure of one task does not alter the status or outcome of the others", async () => {
    const user = await readyUser(env.server, "DEVELOPER");

    // DOCS_INLINE fails with a parsing error; the other two succeed.
    env.agent.invoke.mockImplementation((task: TaskDocument) =>
      Promise.resolve(
        task.operation === "DOCS_INLINE"
          ? {
              status: "FAILED",
              error: {
                code: "PARSING",
                message: "model response not interpretable",
                stage: "EXECUTION",
              },
            }
          : successOutcome(task.operation),
      ),
    );

    const completed = await runBatch(user.token, user.contextId);

    const failed = completed.get("DOCS_INLINE")!;
    expect(failed.status).toBe("FAILED");
    expect(failed.error?.code).toBe("PARSING");

    for (const operation of ["DOCS_README", "DOCS_API"]) {
      const task = completed.get(operation)!;
      // The error included in the comparison: if one of these failed,
      // knowing *which* error it inherited is exactly the information
      // that matters.
      expect({ operation, status: task.status, error: task.error }).toEqual({
        operation,
        status: "COMPLETED",
        error: null,
      });
      expect(task.reportId).toBeTruthy();
    }
  }, 180_000);

  it("each task in the batch has its own Report, with the content of its own operation", async () => {
    // The way isolation would break without the state showing it:
    // three COMPLETED tasks all pointing to the same Report, or to
    // Reports with the content of another operation.
    const user = await readyUser(env.server, "DEVELOPER");
    env.agent.invoke.mockImplementation((task: TaskDocument) =>
      Promise.resolve(successOutcome(task.operation)),
    );

    const completed = await runBatch(user.token, user.contextId);

    const reportIds = new Set<string>();
    for (const operation of OPERATIONS) {
      const task = completed.get(operation)!;
      expect(task.status).toBe("COMPLETED");
      reportIds.add(String(task.reportId));

      const read = await request(env.server)
        .get(`/api/v1/reports/${task.reportId}`)
        .set("Authorization", `Bearer ${user.token}`)
        .expect(200);

      expect(read.body.operation).toBe(operation);
      expect(read.body.summary).toBe(`Summary of ${operation}.`);
    }
    expect(reportIds.size).toBe(3);
  }, 180_000);

  it("an exception thrown during one task does not overwhelm the others", async () => {
    // Different from the case above: here the agent does not respond
    // "FAILED", it blows up. This is the catch path of TaskProcessor, the
    // one in which a failure can truly escape the boundaries of a single
    // task.
    const user = await readyUser(env.server, "DEVELOPER");
    env.agent.invoke.mockImplementation((task: TaskDocument) =>
      task.operation === "DOCS_API"
        ? Promise.reject(new Error("the agent service closed the connection"))
        : Promise.resolve(successOutcome(task.operation)),
    );

    const completed = await runBatch(user.token, user.contextId);

    expect(completed.get("DOCS_API")!.status).toBe("FAILED");
    expect(completed.get("DOCS_README")!.status).toBe("COMPLETED");
    expect(completed.get("DOCS_INLINE")!.status).toBe("COMPLETED");
  }, 180_000);

  it("even a failed task leaves a readable Report, not a hole", async () => {
    // RF.48 concerns the other tasks, but the failed task must not
    // disappear: its FAILED Report is what distinguishes "failed" from
    // "never executed".
    const user = await readyUser(env.server, "DEVELOPER");
    env.agent.invoke.mockImplementation((task: TaskDocument) =>
      Promise.resolve(
        task.operation === "DOCS_INLINE"
          ? {
              status: "FAILED",
              error: {
                code: "TIMEOUT",
                message: "no response from the model",
                stage: "EXECUTION",
              },
            }
          : successOutcome(task.operation),
      ),
    );

    const completed = await runBatch(user.token, user.contextId);
    const failed = completed.get("DOCS_INLINE")!;

    expect(failed.reportId).toBeTruthy();
    const read = await request(env.server)
      .get(`/api/v1/reports/${failed.reportId}`)
      .set("Authorization", `Bearer ${user.token}`)
      .expect(200);

    expect(read.body.status).toBe("FAILED");
    expect(read.body.operation).toBe("DOCS_INLINE");
  }, 180_000);

  it("the batch tasks stay of the same batch, and none drags another", async () => {
    // The batchId is the only thing the three share by design:
    // it is good that it stays shared, and it is good that it is the only
    // thing.
    const user = await readyUser(env.server, "DEVELOPER");
    env.agent.invoke.mockImplementation((task: TaskDocument) =>
      Promise.resolve(
        task.operation === "DOCS_README"
          ? {
              status: "FAILED",
              error: {
                code: "UPSTREAM",
                message: "the agent service responded 502",
                stage: "EXECUTION",
              },
            }
          : successOutcome(task.operation),
      ),
    );

    const completed = await runBatch(user.token, user.contextId);

    const batchIds = new Set([...completed.values()].map((t) => t.batchId));
    expect(batchIds.size).toBe(1);

    const outcomes = [...completed.values()].map((t) => t.status).sort();
    expect(outcomes).toEqual(["COMPLETED", "COMPLETED", "FAILED"]);
    expect(env.agent.invoke).toHaveBeenCalledTimes(3);
  }, 180_000);
});
