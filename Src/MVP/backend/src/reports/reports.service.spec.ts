import { NotFoundException } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { Test, TestingModule } from "@nestjs/testing";
import { type Mock, vi } from "vitest";
import { Task } from "../tasks/schemas/task.schema";
import { ReportArtifactStorageService } from "./report-artifact-storage.service";
import { ReportsService } from "./reports.service";
import { Report } from "./schemas/report.schema";

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "report1",
    taskId: { toString: () => "task1" },
    operation: "DOCS_README",
    status: "COMPLETED",
    title: "README generation/update — owner/repo@main",
    summary: "all good",
    durationMs: 4200,
    tokensConsumed: 100,
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    context: { repoOwner: "owner", repoName: "repo" },
    body: [{ kind: "TEXT", markdown: "hi" }],
    proposal: undefined,
    error: undefined,
    ...overrides,
  };
}

describe("ReportsService", () => {
  let service: ReportsService;
  let reportModel: { find: Mock; findOne: Mock; findOneAndDelete: Mock };
  let taskModel: { findById: Mock; updateOne: Mock };
  let artifactStorage: { deleteReportArtifact: Mock };

  beforeEach(async () => {
    reportModel = { find: vi.fn(), findOne: vi.fn(), findOneAndDelete: vi.fn() };
    taskModel = { findById: vi.fn(), updateOne: vi.fn().mockResolvedValue({}) };
    artifactStorage = { deleteReportArtifact: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getModelToken(Report.name), useValue: reportModel },
        { provide: getModelToken(Task.name), useValue: taskModel },
        { provide: ReportArtifactStorageService, useValue: artifactStorage },
      ],
    }).compile();

    service = module.get(ReportsService);
  });

  describe("findAllForUser", () => {
    it("scopes the query to the caller and returns thin summaries, newest first", async () => {
      const sort = vi.fn().mockResolvedValue([makeReport()]);
      reportModel.find.mockReturnValue({ sort });

      const result = await service.findAllForUser("user1", {});

      expect(reportModel.find).toHaveBeenCalledWith({ userId: "user1" });
      expect(sort).toHaveBeenCalledWith({ generatedAt: -1 });
      expect(result).toEqual([
        {
          id: "report1",
          operation: "DOCS_README",
          status: "COMPLETED",
          title: "README generation/update — owner/repo@main",
          generatedAt: "2026-01-01T00:00:00.000Z",
          durationMs: 4200,
        },
      ]);
      // Thin on purpose — body/proposal/error/summary never leak
      // into the list.
      expect(result[0]).not.toHaveProperty("body");
      expect(result[0]).not.toHaveProperty("summary");
    });

    it("adds an operation filter when provided", async () => {
      const sort = vi.fn().mockResolvedValue([]);
      reportModel.find.mockReturnValue({ sort });

      await service.findAllForUser("user1", { operation: "SECURITY_OWASP" });

      expect(reportModel.find).toHaveBeenCalledWith({
        userId: "user1",
        operation: "SECURITY_OWASP",
      });
    });

    it("adds a generatedAt range filter from from/to", async () => {
      const sort = vi.fn().mockResolvedValue([]);
      reportModel.find.mockReturnValue({ sort });

      await service.findAllForUser("user1", {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
      });

      expect(reportModel.find).toHaveBeenCalledWith({
        userId: "user1",
        generatedAt: {
          $gte: new Date("2026-01-01T00:00:00.000Z"),
          $lte: new Date("2026-02-01T00:00:00.000Z"),
        },
      });
    });
  });

  describe("findOneForUser", () => {
    it("throws NotFoundException when no report matches (id, userId) together", async () => {
      reportModel.findOne.mockResolvedValue(null);

      await expect(service.findOneForUser("user1", "report1")).rejects.toThrow(NotFoundException);
      expect(reportModel.findOne).toHaveBeenCalledWith({
        _id: "report1",
        userId: "user1",
      });
    });

    it("throws the same NotFoundException for a report owned by someone else — 404, never 403", async () => {
      reportModel.findOne.mockResolvedValue(null);

      await expect(service.findOneForUser("attacker", "someone-elses-report")).rejects.toThrow(
        NotFoundException,
      );

      // Senza questa asserzione il test era un doppione del precedente: il
      // mock risolve a null a prescindere dagli argomenti, quindi "il
      // report è di un altro" non veniva mai messo in scena. È qui che si
      // vede che l'identità di chi chiede entra nella query — e che non
      // esiste un ramo che carichi il report e poi risponda 403.
      expect(reportModel.findOne).toHaveBeenCalledWith({
        _id: "someone-elses-report",
        userId: "attacker",
      });
    });

    it("returns the full ReportDto with pendingAction taken from the owning Task", async () => {
      const report = makeReport();
      reportModel.findOne.mockResolvedValue(report);
      taskModel.findById.mockResolvedValue({
        pendingInput: {
          kind: "BUSINESS_CONFIRMATION",
          technicalChangelog: "## Sprint 1",
          technicalChangelogTruncated: false,
        },
      });

      const result = await service.findOneForUser("user1", "report1");

      expect(taskModel.findById).toHaveBeenCalledWith(report.taskId);
      expect(result.pendingAction).toEqual({
        kind: "BUSINESS_CONFIRMATION",
        technicalChangelog: "## Sprint 1",
        technicalChangelogTruncated: false,
      });
      expect(result.taskId).toBe("task1");
      expect(result.body).toEqual([{ kind: "TEXT", markdown: "hi" }]);
    });

    it("degrades pendingAction to null rather than failing when the owning Task is missing", async () => {
      reportModel.findOne.mockResolvedValue(makeReport());
      taskModel.findById.mockResolvedValue(null);

      const result = await service.findOneForUser("user1", "report1");

      expect(result.pendingAction).toBeNull();
    });
  });

  describe("removeForUser", () => {
    it("deletes only the caller report, clears its Task link, and removes its archived PDF", async () => {
      const report = makeReport({ _id: "report-oid" });
      reportModel.findOneAndDelete.mockResolvedValue(report);

      await service.removeForUser("user1", "report1");

      expect(reportModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: "report1",
        userId: "user1",
      });
      expect(taskModel.updateOne).toHaveBeenCalledWith(
        { _id: report.taskId, userId: "user1", reportId: "report-oid" },
        { $set: { reportId: null } },
      );
      expect(artifactStorage.deleteReportArtifact).toHaveBeenCalledWith("report1");
    });

    it("returns the same 404 for an absent or another user's report", async () => {
      reportModel.findOneAndDelete.mockResolvedValue(null);

      await expect(service.removeForUser("attacker", "someone-elses-report")).rejects.toThrow(
        NotFoundException,
      );
      expect(reportModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: "someone-elses-report",
        userId: "attacker",
      });
      expect(taskModel.updateOne).not.toHaveBeenCalled();
      expect(artifactStorage.deleteReportArtifact).not.toHaveBeenCalled();
    });

    it("keeps the successful deletion when object storage is unavailable", async () => {
      reportModel.findOneAndDelete.mockResolvedValue(makeReport({ _id: "report-oid" }));
      artifactStorage.deleteReportArtifact.mockRejectedValue(new Error("storage unavailable"));

      await expect(service.removeForUser("user1", "report1")).resolves.toBeUndefined();
      expect(taskModel.updateOne).toHaveBeenCalled();
    });
  });
});
