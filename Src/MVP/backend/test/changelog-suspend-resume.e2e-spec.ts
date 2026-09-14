import request from "supertest";
import { TaskDocument } from "./../src/tasks/schemas/task.schema";
import { E2EEnvironment, waitForCondition, waitForOutcome, startEnvironment, readyUser } from "./e2e-helpers";

/**
 * TI_09 (RF.94, 98, 100, 103, 104, 57) and TI_10 (RF.99, 102, 105) — the three
 * suspensions of CHANGELOG_BUSINESS, the resume and the cancellation.
 *
 * PARTIAL coverage, and the boundary is declared: the Test Plan describes
 * TI_09 as the verification of the `interrupt` / `Command(resume=...)`
 * mechanism of LangGraph with the MongoDB checkpointer. That mechanism
 * lives in the Python agent service, and here the agent service is a mock.
 * What these tests verify is the other half, the one that lives in the
 * backend and that no unit test sees in full: that the task goes through
 * the three suspensions in the right order, that each user response
 * re-queues it, that cancellation is possible at each of the three points,
 * and that the time recorded on the Report is only machine time.
 *
 * The first suspension, SPRINT_ID, is special: TaskProcessor raises it on
 * its own, before talking to the agent (startOrPause), because without a
 * sprintId the agent would have nothing to start from. The other two come
 * from the agent. That is also why the mock is called twice and not three.
 *
 * To measure RF.57 the agent mock takes a known time on each call, and the
 * test lets much more time pass between one response and the next than
 * that: if `durationMs` counted user waits, the difference would be
 * obvious rather than subtle.
 */
describe("TI_09 / TI_10 — suspension, resume and cancellation of CHANGELOG_BUSINESS", () => {
  let env: E2EEnvironment;

  /** Simulated machine time of a single call to the agent. */
  const MS_PER_CALL = 250;
  /** User wait between a suspension and its response. */
  const MS_USER_WAIT = 900;

  const SUSPENSION_2 = {
    kind: "INCOMPLETE_TASKS" as const,
    taskIds: ["CG-101", "CG-102"],
  };
  const SUSPENSION_3 = {
    kind: "BUSINESS_CONFIRMATION" as const,
    technicalChangelog: "## Sprint 1\n\n- #12 login",
    technicalChangelogTruncated: false,
  };

  function wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** An agent response that costs a known machine time. */
  async function afterMachineTime<T>(result: T): Promise<T> {
    await wait(MS_PER_CALL);
    return result;
  }

  /** Starts a CHANGELOG_BUSINESS and returns the task id. */
  async function startChangelogBusiness(user: {
    token: string;
    contextId: string;
  }): Promise<string> {
    const start = await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        contextId: user.contextId,
        operations: ["CHANGELOG_BUSINESS"],
      })
      .expect(202);
    return start.body.taskIds[0] as string;
  }

  /** Waits for the task to stop at the indicated suspension. */
  async function waitForSuspension(taskId: string, kind: string): Promise<TaskDocument> {
    await waitForCondition(async () => {
      const task = await env.taskModel.findById(taskId);
      return task?.pendingInput?.kind === kind;
    }, `task ${taskId} stops at ${kind}`);
    return (await env.taskModel.findById(taskId))!;
  }

  /** Responds to a suspension, after letting time pass. */
  async function respond(
    token: string,
    taskId: string,
    body: Record<string, unknown>,
    expected = 204,
  ) {
    await wait(MS_USER_WAIT);
    return request(env.server)
      .post(`/api/v1/tasks/${taskId}/input`)
      .set("Authorization", `Bearer ${token}`)
      .send(body)
      .expect(expected);
  }

  /**
   * Configures the mock for the nominal path: two suspensions from the
   * agent, then completion.
   */
  function agentWithThreeSuspensions(): void {
    env.agent.invoke.mockImplementation(() =>
      afterMachineTime({
        status: "INTERRUPTED",
        pendingInput: SUSPENSION_2,
      }),
    );
    let resumesMade = 0;
    env.agent.resume.mockImplementation(() => {
      resumesMade += 1;
      return afterMachineTime(
        resumesMade === 1
          ? { status: "INTERRUPTED", pendingInput: SUSPENSION_3 }
          : {
              status: "COMPLETED",
              payload: {
                body: [
                  {
                    kind: "TEXT",
                    markdown: "Business changelog for the sprint.",
                  },
                ],
                summary: "Business changelog ready.",
                tokensConsumed: 480,
              },
            },
      );
    });
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
    env.github.listIssues.mockClear();
    env.github.getIssueDetail.mockClear();
  });

  it("TI_09 — goes through the three suspensions in the expected order and reaches COMPLETED", async () => {
    const user = await readyUser(env.server, "PROJECT_MANAGER");
    agentWithThreeSuspensions();

    const taskId = await startChangelogBusiness(user);

    // First suspension: SPRINT_ID, raised by the backend before
    // consulting the agent.
    const firstStop = await waitForSuspension(taskId, "SPRINT_ID");
    expect(firstStop.status).toBe("RUNNING");
    expect(env.agent.invoke).not.toHaveBeenCalled();

    await respond(user.token, taskId, {
      kind: "SPRINT_ID",
      sprintId: "SPRINT-42",
    });

    // Second suspension: INCOMPLETE_TASKS, from the agent.
    const secondStop = await waitForSuspension(taskId, "INCOMPLETE_TASKS");
    expect(secondStop.pendingInput).toEqual(SUSPENSION_2);
    expect(env.agent.invoke).toHaveBeenCalledTimes(1);

    await respond(user.token, taskId, {
      kind: "INCOMPLETE_TASKS",
      action: "PROCEED",
    });

    // Third suspension: BUSINESS_CONFIRMATION.
    const thirdStop = await waitForSuspension(taskId, "BUSINESS_CONFIRMATION");
    expect(thirdStop.pendingInput).toEqual(SUSPENSION_3);

    await respond(user.token, taskId, {
      kind: "BUSINESS_CONFIRMATION",
      action: "PROCEED",
    });

    const completed = await waitForOutcome(env.taskModel, taskId);
    expect({ status: completed.status, error: completed.error }).toMatchObject({
      status: "COMPLETED",
    });
    expect(completed.pendingInput).toBeNull();
    // One invocation and two resumes: the first suspension did not come
    // from the agent, so the count is two and not three.
    expect(env.agent.invoke).toHaveBeenCalledTimes(1);
    expect(env.agent.resume).toHaveBeenCalledTimes(2);
  }, 180_000);

  it("TI_09 (RF.57) — the recorded time sums only the machine segments", async () => {
    const user = await readyUser(env.server, "PROJECT_MANAGER");
    agentWithThreeSuspensions();

    const start = Date.now();
    const taskId = await startChangelogBusiness(user);

    await waitForSuspension(taskId, "SPRINT_ID");
    await respond(user.token, taskId, {
      kind: "SPRINT_ID",
      sprintId: "SPRINT-42",
    });
    await waitForSuspension(taskId, "INCOMPLETE_TASKS");
    await respond(user.token, taskId, {
      kind: "INCOMPLETE_TASKS",
      action: "PROCEED",
    });
    await waitForSuspension(taskId, "BUSINESS_CONFIRMATION");
    await respond(user.token, taskId, {
      kind: "BUSINESS_CONFIRMATION",
      action: "PROCEED",
    });

    const completed = await waitForOutcome(env.taskModel, taskId);
    const actualDuration = Date.now() - start;

    const report = await env.reportModel.findById(completed.reportId);
    const recorded = report!.durationMs!;

    // At least the machine time of the two segments that go through the agent.
    expect(recorded).toBeGreaterThanOrEqual(2 * MS_PER_CALL);
    // And less than the actual elapsed time, by a margin that cannot be
    // explained by machine slowness: the three user waits alone add up to
    // more than two and a half seconds.
    expect(recorded).toBeLessThan(actualDuration - 2 * MS_USER_WAIT);
    // The field on the Task and the one on the Report tell the same story.
    expect(completed.accumulatedMs).toBe(recorded);
  }, 180_000);

  it.each([
    ["SPRINT_ID", undefined],
    ["INCOMPLETE_TASKS", undefined],
    ["BUSINESS_CONFIRMATION", undefined],
  ])(
    "TI_10 — cancelling at suspension %s sends the task to CANCELLED with no further calls",
    async (stop) => {
      const user = await readyUser(env.server, "PROJECT_MANAGER");
      agentWithThreeSuspensions();

      const taskId = await startChangelogBusiness(user);
      await waitForSuspension(taskId, "SPRINT_ID");

      if (stop !== "SPRINT_ID") {
        await respond(user.token, taskId, {
          kind: "SPRINT_ID",
          sprintId: "SPRINT-42",
        });
        await waitForSuspension(taskId, "INCOMPLETE_TASKS");
      }
      if (stop === "BUSINESS_CONFIRMATION") {
        await respond(user.token, taskId, {
          kind: "INCOMPLETE_TASKS",
          action: "PROCEED",
        });
        await waitForSuspension(taskId, "BUSINESS_CONFIRMATION");
      }

      const invocationsBefore = env.agent.invoke.mock.calls.length;
      const resumesBefore = env.agent.resume.mock.calls.length;
      const issuesBefore = env.github.listIssues.mock.calls.length;

      await request(env.server)
        .post(`/api/v1/tasks/${taskId}/cancel`)
        .set("Authorization", `Bearer ${user.token}`)
        .expect(204);

      const cancelled = await env.taskModel.findById(taskId);
      expect(cancelled!.status).toBe("CANCELLED");

      // No further calls to the model or Task Management after
      // cancellation: this is the guarantee of RF.99/102/105, and must be
      // checked after giving the worker time to do any damage.
      await wait(1_000);
      expect(env.agent.invoke).toHaveBeenCalledTimes(invocationsBefore);
      expect(env.agent.resume).toHaveBeenCalledTimes(resumesBefore);
      expect(env.github.listIssues).toHaveBeenCalledTimes(issuesBefore);
      expect((await env.taskModel.findById(taskId))!.status).toBe("CANCELLED");
    },
    180_000,
  );

  it("TI_10 — cancelling by responding CANCEL to a suspension has the same effect", async () => {
    // The other path that the interface offers: the "Cancel" button of the
    // confirmation dialog, which goes through POST /tasks/:id/input and not
    // /cancel.
    const user = await readyUser(env.server, "PROJECT_MANAGER");
    agentWithThreeSuspensions();

    const taskId = await startChangelogBusiness(user);
    await waitForSuspension(taskId, "SPRINT_ID");
    await respond(user.token, taskId, {
      kind: "SPRINT_ID",
      sprintId: "SPRINT-42",
    });
    await waitForSuspension(taskId, "INCOMPLETE_TASKS");

    const resumesBefore = env.agent.resume.mock.calls.length;

    await respond(user.token, taskId, {
      kind: "INCOMPLETE_TASKS",
      action: "CANCEL",
    });

    const cancelled = await env.taskModel.findById(taskId);
    expect(cancelled!.status).toBe("CANCELLED");
    expect(cancelled!.pendingInput).toBeNull();

    await wait(1_000);
    expect(env.agent.resume).toHaveBeenCalledTimes(resumesBefore);
  }, 180_000);

  it("TI_10 — a response arriving after cancellation does not start the agent", async () => {
    // What holds, and is the guarantee that matters for RF.99/102/105: the
    // claim() filter in TaskProcessor accepts only PENDING and RUNNING,
    // so the job queued by a late response is a no-op and the agent is
    // never called. The defect documented below is upstream, in the
    // response that the API returns.
    const user = await readyUser(env.server, "PROJECT_MANAGER");
    agentWithThreeSuspensions();

    const taskId = await startChangelogBusiness(user);
    await waitForSuspension(taskId, "SPRINT_ID");

    await request(env.server)
      .post(`/api/v1/tasks/${taskId}/cancel`)
      .set("Authorization", `Bearer ${user.token}`)
      .expect(204);

    await request(env.server)
      .post(`/api/v1/tasks/${taskId}/input`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ kind: "SPRINT_ID", sprintId: "SPRINT-42" });

    await wait(1_500);
    expect(env.agent.invoke).not.toHaveBeenCalled();
    expect(env.agent.resume).not.toHaveBeenCalled();
    expect((await env.taskModel.findById(taskId))!.status).toBe("CANCELLED");
  }, 180_000);

  it("TI_10 — /cancel clears pendingInput, and the task no longer accepts responses", async () => {
    // TasksService.cancel calls markCancelled without the `{ pendingInput:
    // null }` that the CANCEL path of POST /tasks/:id/input passes instead,
    // while the comment in the code declares that the two paths perform
    // "the same transition". They do not: after /cancel the task stays
    // CANCELLED with an input request still open, submitInput finds it
    // valid, responds 204 and queues a job for a cancelled task.
    //
    // The agent does not start anyway — verified by the test above — so
    // the effect is contained: the API confirms a response that will
    // produce nothing, and GET /tasks/:id continues to declare a
    // pendingInput on a terminal task, which is the field on which the
    // interface decides whether to show the dialog.
    const user = await readyUser(env.server, "PROJECT_MANAGER");
    agentWithThreeSuspensions();

    const taskId = await startChangelogBusiness(user);
    await waitForSuspension(taskId, "SPRINT_ID");

    await request(env.server)
      .post(`/api/v1/tasks/${taskId}/cancel`)
      .set("Authorization", `Bearer ${user.token}`)
      .expect(204);

    const cancelled = await env.taskModel.findById(taskId);
    expect(cancelled!.pendingInput).toBeNull();

    await request(env.server)
      .post(`/api/v1/tasks/${taskId}/input`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ kind: "SPRINT_ID", sprintId: "SPRINT-42" })
      .expect(409);
  }, 180_000);

  it("a response that does not match the current suspension is rejected", async () => {
    // Protects against the case where two open tabs respond to two
    // different suspensions of the same task.
    const user = await readyUser(env.server, "PROJECT_MANAGER");
    agentWithThreeSuspensions();

    const taskId = await startChangelogBusiness(user);
    await waitForSuspension(taskId, "SPRINT_ID");

    await request(env.server)
      .post(`/api/v1/tasks/${taskId}/input`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({ kind: "BUSINESS_CONFIRMATION", action: "PROCEED" })
      .expect(409);

    const task = await env.taskModel.findById(taskId);
    expect(task!.pendingInput?.kind).toBe("SPRINT_ID");
  }, 180_000);
});
