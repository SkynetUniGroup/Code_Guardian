import { NotFoundException } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { Test, TestingModule } from "@nestjs/testing";
import { Types } from "mongoose";
import { type Mock, vi } from "vitest";
import { AnalysisContext } from "../contexts/schemas/analysis-context.schema";
import { CredentialsService } from "../credentials/credentials.service";
import { Task } from "../tasks/schemas/task.schema";
import { InternalTaskContextResolver } from "./internal-task-context.resolver";

describe("InternalTaskContextResolver", () => {
  let resolver: InternalTaskContextResolver;
  let taskModel: { findById: Mock };
  let contextModel: { findById: Mock };
  let credentials: { getDecryptedToken: Mock };

  const contextId = new Types.ObjectId();

  beforeEach(async () => {
    taskModel = { findById: vi.fn() };
    contextModel = { findById: vi.fn() };
    credentials = { getDecryptedToken: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InternalTaskContextResolver,
        { provide: getModelToken(Task.name), useValue: taskModel },
        {
          provide: getModelToken(AnalysisContext.name),
          useValue: contextModel,
        },
        { provide: CredentialsService, useValue: credentials },
      ],
    }).compile();

    resolver = module.get(InternalTaskContextResolver);
  });

  it("resolves owner, repo, resolvedSha, and a decrypted token from a taskId", async () => {
    taskModel.findById.mockResolvedValue({
      userId: "user1",
      contextId,
    });
    contextModel.findById.mockResolvedValue({
      repoOwner: "octocat",
      repoName: "hello-world",
      resolvedSha: "abc123",
    });
    credentials.getDecryptedToken.mockResolvedValue("ghp_decrypted");

    const result = await resolver.resolve("task1");

    expect(taskModel.findById).toHaveBeenCalledWith("task1");
    expect(contextModel.findById).toHaveBeenCalledWith(contextId);
    expect(credentials.getDecryptedToken).toHaveBeenCalledWith("user1", "GITHUB");
    expect(result).toEqual({
      taskId: "task1",
      owner: "octocat",
      repo: "hello-world",
      resolvedSha: "abc123",
      token: "ghp_decrypted",
    });
  });

  it("throws NotFoundException when the task does not exist", async () => {
    taskModel.findById.mockResolvedValue(null);

    await expect(resolver.resolve("missing")).rejects.toThrow(NotFoundException);
    expect(contextModel.findById).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when the task references a missing context", async () => {
    taskModel.findById.mockResolvedValue({ userId: "user1", contextId });
    contextModel.findById.mockResolvedValue(null);

    await expect(resolver.resolve("task1")).rejects.toThrow(NotFoundException);
    expect(credentials.getDecryptedToken).not.toHaveBeenCalled();
  });

  it("propagates a missing-credential failure from CredentialsService", async () => {
    taskModel.findById.mockResolvedValue({ userId: "user1", contextId });
    contextModel.findById.mockResolvedValue({
      repoOwner: "octocat",
      repoName: "hello-world",
      resolvedSha: "abc123",
    });
    credentials.getDecryptedToken.mockRejectedValue(
      new NotFoundException("No GITHUB credential configured"),
    );

    await expect(resolver.resolve("task1")).rejects.toThrow(NotFoundException);
  });
});
