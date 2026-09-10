import { Test, TestingModule } from "@nestjs/testing";
import { type Mock, vi } from "vitest";
import type { AuthenticatedUser } from "../common/authenticated-user";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

describe("TasksController", () => {
  let controller: TasksController;
  let service: {
    createBatch: Mock;
    findAllForUser: Mock;
    findOneForUser: Mock;
    cancel: Mock;
    submitInput: Mock;
  };

  const caller: AuthenticatedUser = { userId: "user-1", role: "SECURITY_AUDITOR" };

  const task = {
    id: "task-1",
    operation: "SECURITY_OWASP",
    status: "PENDING",
    progressPercent: 0,
  };

  beforeEach(async () => {
    service = {
      createBatch: vi.fn().mockResolvedValue({ batchId: "batch-1", taskIds: ["task-1"] }),
      findAllForUser: vi.fn().mockResolvedValue([task]),
      findOneForUser: vi.fn().mockResolvedValue(task),
      cancel: vi.fn().mockResolvedValue(undefined),
      submitInput: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [{ provide: TasksService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TasksController>(TasksController);
  });

  it("passes the whole caller to the batch creation, role included", async () => {
    // A batch can mix operations belonging to different agents, so the
    // permission check happens per operation inside the service — which
    // needs the role, not just the id.
    const dto = { contextId: "ctx-1", operations: ["SECURITY_OWASP"] };

    await expect(controller.create(caller, dto as never)).resolves.toEqual({
      batchId: "batch-1",
      taskIds: ["task-1"],
    });
    expect(service.createBatch).toHaveBeenCalledWith(caller, dto);
  });

  it("lists only the tasks belonging to the caller", async () => {
    await expect(controller.findAll("user-1")).resolves.toEqual([task]);
    expect(service.findAllForUser).toHaveBeenCalledWith("user-1");
  });

  it("scopes a single task lookup to the caller", async () => {
    // Without the user id here, any authenticated caller could read any
    // task by guessing its id.
    await expect(controller.findOne("user-1", "task-1")).resolves.toEqual(task);
    expect(service.findOneForUser).toHaveBeenCalledWith("user-1", "task-1");
  });

  it("scopes a cancellation to the caller", async () => {
    await controller.cancel("user-1", "task-1");

    expect(service.cancel).toHaveBeenCalledWith("user-1", "task-1");
  });

  it("routes all three kinds of pending input through the same endpoint", async () => {
    const kinds = [
      { kind: "SPRINT_ID", sprintId: "SPRINT-42" },
      { kind: "INCOMPLETE_TASKS", action: "PROCEED" },
      { kind: "BUSINESS_CONFIRMATION", action: "CANCEL" },
    ];

    for (const dto of kinds) {
      await controller.submitInput("user-1", "task-1", dto as never);
    }

    expect(service.submitInput).toHaveBeenCalledTimes(3);
    expect(service.submitInput).toHaveBeenLastCalledWith("user-1", "task-1", kinds[2]);
  });

  it("does not swallow a rejection from the service", async () => {
    service.findOneForUser.mockRejectedValueOnce(new Error("Task not found"));

    await expect(controller.findOne("user-1", "sconosciuta")).rejects.toThrow("Task not found");
  });
});
