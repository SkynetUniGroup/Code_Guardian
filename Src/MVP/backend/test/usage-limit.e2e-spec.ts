import { ConfigService } from "@nestjs/config";
import request from "supertest";
import { vi } from "vitest";
import { E2EEnvironment, waitForOutcome, startEnvironment, readyUser } from "./e2e-helpers";

/**
 * TI_15 (RF.66, RV.6) — the monthly limit is checked before
 * enqueueing, and a batch that exceeds it is rejected in full.
 *
 * The two halves of the requirement are separable and must be verified
 * separately: "before enqueueing" is a property on order (no job enters
 * the queue), "without partial enqueueing" is a property on atomicity
 * (zero Tasks, not two out of three). A test that only looked at the 429
 * would pass even with a backend that enqueues the first two operations
 * and then notices the limit on the third.
 *
 * The counter is seeded directly on Mongo instead of consuming fifty real
 * operations: the configured limit is a parameter, and a test that
 * depended on its value would need to be rewritten at every .env change.
 */
describe("TI_15 (RF.66, RV.6) — monthly limit before enqueueing", () => {
  let env: E2EEnvironment;
  let limit: number;
  let queueSpy: MockInstance;

  /** The current month in the "YYYY-MM" format used by UsageCounter. */
  function currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }

  /** Brings the user's counter to the given value. */
  async function seedCounter(userId: string, count: number): Promise<void> {
    await env.usageModel.updateOne(
      { userId, yearMonth: currentMonth() },
      { $set: { count } },
      { upsert: true },
    );
  }

  /** The recorded consumption for the user in the current month. */
  async function consumption(userId: string): Promise<number> {
    const counter = await env.usageModel.findOne({
      userId,
      yearMonth: currentMonth(),
    });
    return counter?.count ?? 0;
  }

  beforeAll(async () => {
    env = await startEnvironment();
    limit = env.app.get(ConfigService).get<number>("MONTHLY_TASK_LIMIT")!;
    // The limit is configurable: reading it instead of repeating it here
    // prevents the test from depending on the value .env has today.
    expect(limit).toBeGreaterThanOrEqual(3);
  }, 60_000);

  afterAll(async () => {
    await env?.close();
  });

  beforeEach(() => {
    env.agent.invoke.mockReset();
    env.agent.resume.mockReset();
    env.agent.invoke.mockResolvedValue({
      status: "COMPLETED",
      payload: { body: [], summary: "no findings", tokensConsumed: 10 },
    });
    // The spy on enqueueing is the only direct way to distinguish
    // "checked before" from "checked after enqueueing and then cleaned
    // up": watching the queue length is not enough, the worker consumes
    // it on its own while the test watches.
    queueSpy = vi.spyOn(env.queue, "addBulk");
  });

  afterEach(() => {
    queueSpy.mockRestore();
  });

  it("a batch that exceeds the limit is rejected with 429 USAGE_LIMIT_EXCEEDED", async () => {
    const user = await readyUser(env.server, "DEVELOPER");
    await seedCounter(user.userId, limit - 1);

    const response = await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        contextId: user.contextId,
        operations: ["DOCS_README", "DOCS_INLINE", "DOCS_API"],
      })
      .expect(429);

    expect(response.body.code).toBe("USAGE_LIMIT_EXCEEDED");
  }, 120_000);

  it("the check precedes enqueueing: no job enters the queue", async () => {
    const user = await readyUser(env.server, "DEVELOPER");
    await seedCounter(user.userId, limit - 1);

    await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        contextId: user.contextId,
        operations: ["DOCS_README", "DOCS_INLINE", "DOCS_API"],
      })
      .expect(429);

    expect(queueSpy).not.toHaveBeenCalled();
    expect(env.agent.invoke).not.toHaveBeenCalled();
  }, 120_000);

  it("the rejection is total: no operation of the batch is persisted", async () => {
    // The case that distinguishes "rejected" from "rejected in full": with
    // two remaining slots and three requested operations, a backend that
    // enqueued while it could would persist two.
    const user = await readyUser(env.server, "DEVELOPER");
    await seedCounter(user.userId, limit - 2);

    await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        contextId: user.contextId,
        operations: ["DOCS_README", "DOCS_INLINE", "DOCS_API"],
      })
      .expect(429);

    expect(await env.taskModel.countDocuments({ userId: user.userId })).toBe(0);
    expect(queueSpy).not.toHaveBeenCalled();
  }, 120_000);

  it("a rejected batch does not consume the quota it had reserved", async () => {
    // UsageLimitService increments and then rolls back: if the compensation
    // failed, a user at the limit would be rejected and would also pay for
    // the three operations never executed, and each subsequent attempt
    // would push them further away.
    const user = await readyUser(env.server, "DEVELOPER");
    await seedCounter(user.userId, limit - 1);

    await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        contextId: user.contextId,
        operations: ["DOCS_README", "DOCS_INLINE", "DOCS_API"],
      })
      .expect(429);

    expect(await consumption(user.userId)).toBe(limit - 1);
  }, 120_000);

  it("a batch that fits exactly is accepted and enqueued in full", async () => {
    // The positive control: without it, all the "nothing happened"
    // assertions above would also be satisfied by an endpoint that
    // always rejects.
    const user = await readyUser(env.server, "DEVELOPER");
    await seedCounter(user.userId, limit - 3);

    const start = await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        contextId: user.contextId,
        operations: ["DOCS_README", "DOCS_INLINE", "DOCS_API"],
      })
      .expect(202);

    expect(start.body.taskIds).toHaveLength(3);
    expect(queueSpy).toHaveBeenCalledTimes(1);
    expect(await consumption(user.userId)).toBe(limit);
    expect(await env.taskModel.countDocuments({ userId: user.userId })).toBe(3);

    // The three tasks actually reach the end: the limit did not leave
    // something halfway.
    for (const taskId of start.body.taskIds as string[]) {
      const completed = await waitForOutcome(env.taskModel, taskId);
      expect(completed.status).toBe("COMPLETED");
    }
  }, 180_000);

  it("once the limit is exhausted, even a single operation is rejected", async () => {
    const user = await readyUser(env.server, "DEVELOPER");
    await seedCounter(user.userId, limit);

    const response = await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ contextId: user.contextId, operations: ["DOCS_README"] })
      .expect(429);

    expect(response.body.code).toBe("USAGE_LIMIT_EXCEEDED");
    expect(await consumption(user.userId)).toBe(limit);
    expect(queueSpy).not.toHaveBeenCalled();
  }, 120_000);

  it("the limit is per user: one's does not touch another's", async () => {
    // RF.66 speaks of a "per user" monthly limit: a shared counter
    // would make the service unusable as soon as two people use it.
    const exhausted = await readyUser(env.server, "DEVELOPER");
    const newcomer = await readyUser(env.server, "DEVELOPER");
    await seedCounter(exhausted.userId, limit);

    await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${exhausted.token}`)
      .send({ contextId: exhausted.contextId, operations: ["DOCS_README"] })
      .expect(429);

    await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${newcomer.token}`)
      .send({ contextId: newcomer.contextId, operations: ["DOCS_README"] })
      .expect(202);

    expect(await consumption(newcomer.userId)).toBe(1);
  }, 180_000);
});
