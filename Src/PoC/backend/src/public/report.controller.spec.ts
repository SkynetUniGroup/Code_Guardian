/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { ReportController } from './report.controller.js';
import { Report } from '../domain/schemas/report.schema.js';
import { Task } from '../domain/schemas/task.schema.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

describe('ReportController', () => {
  let controller: ReportController;
  let mockReportModel: { find: jest.Mock; findById: jest.Mock };
  let mockTaskModel: { find: jest.Mock; findOne: jest.Mock };

  function leanExec(resolvedValue: any) {
    return { select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(resolvedValue) };
  }

  beforeEach(async () => {
    mockReportModel = { find: jest.fn(), findById: jest.fn() };
    mockTaskModel = { find: jest.fn(), findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportController],
      providers: [
        { provide: getModelToken(Report.name), useValue: mockReportModel },
        { provide: getModelToken(Task.name), useValue: mockTaskModel },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReportController>(ReportController);
  });

  describe('getReports', () => {
    it('dovrebbe cercare le task dell\'utente con reportId valorizzato e restituire i relativi report ordinati', async () => {
      mockTaskModel.find.mockReturnValue(leanExec([{ reportId: 'r1' }, { reportId: 'r2' }]));
      mockReportModel.find.mockReturnValue(leanExec([{ _id: 'r2' }, { _id: 'r1' }]));

      const result = await controller.getReports('user-1');

      expect(mockTaskModel.find).toHaveBeenCalledWith({ userId: 'user-1', reportId: { $ne: null } });
      expect(mockReportModel.find).toHaveBeenCalledWith({ _id: { $in: ['r1', 'r2'] } });
      expect(result).toEqual([{ _id: 'r2' }, { _id: 'r1' }]);
    });

    it('dovrebbe applicare il filtro per operation quando fornito', async () => {
      mockTaskModel.find.mockReturnValue(leanExec([]));
      mockReportModel.find.mockReturnValue(leanExec([]));

      await controller.getReports('user-1', 'SECURITY_OWASP');

      expect(mockTaskModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'SECURITY_OWASP' }),
      );
    });

    it('dovrebbe applicare i filtri di data from/to come $gte/$lte su createdAt', async () => {
      mockTaskModel.find.mockReturnValue(leanExec([]));
      mockReportModel.find.mockReturnValue(leanExec([]));

      await controller.getReports('user-1', undefined, '2026-01-01', '2026-01-31');

      const queryArg = mockTaskModel.find.mock.calls[0][0];
      expect(queryArg.createdAt.$gte).toEqual(new Date('2026-01-01'));
      expect(queryArg.createdAt.$lte).toEqual(new Date('2026-01-31'));
    });
  });

  describe('getReport', () => {
    it('dovrebbe lanciare NotFoundException se il report non esiste', async () => {
      mockReportModel.findById.mockReturnValue(leanExec(null));

      await expect(controller.getReport('r1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('dovrebbe lanciare NotFoundException se il report esiste ma la task associata non appartiene all\'utente', async () => {
      mockReportModel.findById.mockReturnValue(leanExec({ _id: 'r1', taskId: 't1' }));
      mockTaskModel.findOne.mockReturnValue(leanExec(null));

      await expect(controller.getReport('r1', 'user-1')).rejects.toThrow(
        /Non sei autorizzato/,
      );
    });

    it('dovrebbe restituire il report quando l\'utente e\' autorizzato', async () => {
      const report = { _id: 'r1', taskId: 't1', status: 'COMPLETED' };
      mockReportModel.findById.mockReturnValue(leanExec(report));
      mockTaskModel.findOne.mockReturnValue(leanExec({ _id: 't1' }));

      const result = await controller.getReport('r1', 'user-1');

      expect(result).toEqual(report);
    });
  });

  describe('exportReport', () => {
    function mockRes() {
      return { setHeader: jest.fn(), send: jest.fn() } as any;
    }

    function mockAuthorizedReport(report: any) {
      mockReportModel.findById.mockReturnValue(leanExec(report));
      mockTaskModel.findOne.mockReturnValue(leanExec({ _id: report.taskId }));
    }

    it('dovrebbe esportare in JSON con i corretti header Content-Type e Content-Disposition', async () => {
      const report = { _id: 'r1', taskId: 't1', status: 'COMPLETED', operation: 'SECURITY_OWASP' };
      mockAuthorizedReport(report);
      const res = mockRes();

      await controller.exportReport('r1', 'json', 'user-1', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('.json'));
      expect(res.send).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
    });

    it('dovrebbe esportare in Markdown includendo la proposal e il body quando presenti', async () => {
      const report = {
        _id: 'r1', taskId: 't1', status: 'COMPLETED', operation: 'DOCS_INLINE',
        summary: 'Fatto', proposal: { diffUnified: '--- a\n+++ b\n' },
        body: [{ kind: 'text', markdown: 'x' }],
      };
      mockAuthorizedReport(report);
      const res = mockRes();

      await controller.exportReport('r1', 'md', 'user-1', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/markdown');
      const sentMarkdown = res.send.mock.calls[0][0] as string;
      expect(sentMarkdown).toContain('## Diff Proposal');
      expect(sentMarkdown).toContain('## Details');
      expect(sentMarkdown).toContain('Fatto');
    });

    it('dovrebbe omettere le sezioni Diff Proposal e Details quando assenti', async () => {
      const report = { _id: 'r1', taskId: 't1', status: 'COMPLETED', operation: 'CHANGELOG_TECHNICAL', body: [] };
      mockAuthorizedReport(report);
      const res = mockRes();

      await controller.exportReport('r1', 'md', 'user-1', res);

      const sentMarkdown = res.send.mock.calls[0][0] as string;
      expect(sentMarkdown).not.toContain('## Diff Proposal');
      expect(sentMarkdown).not.toContain('## Details');
    });

    it('dovrebbe lanciare BadRequestException per un formato non supportato', async () => {
      const report = { _id: 'r1', taskId: 't1', status: 'COMPLETED' };
      mockAuthorizedReport(report);

      await expect(controller.exportReport('r1', 'pdf', 'user-1', mockRes())).rejects.toThrow(BadRequestException);
    });
  });
});
