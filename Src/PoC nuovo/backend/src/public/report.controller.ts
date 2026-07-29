import { Controller, Get, Param, Query, NotFoundException, UseGuards, Res, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Response } from 'express';
import { Report, type ReportDocument } from '../domain/schemas/report.schema.js';
import { Task, type TaskDocument } from '../domain/schemas/task.schema.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('reports')
@UseGuards(JwtAuthGuard) 
export class ReportController {
  constructor(
    @InjectModel(Report.name) private reportModel: Model<ReportDocument>,
    @InjectModel(Task.name) private taskModel: Model<TaskDocument> 
  ) {}

  @Get()
  async getReports(
    @CurrentUser() userId: string,
    @Query('operation') operation?: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    // 1. Troviamo le task dell'utente che hanno prodotto un report
    const taskQuery: any = { userId, reportId: { $ne: null } };
    if (operation) taskQuery.operation = operation;
    
    // Gestione filtri di data
    if (from || to) {
      taskQuery.createdAt = {};
      if (from) taskQuery.createdAt.$gte = new Date(from);
      if (to) taskQuery.createdAt.$lte = new Date(to);
    }

    const tasks = await this.taskModel.find(taskQuery).select('reportId').lean().exec();
    const reportIds = tasks.map(t => t.reportId);

    // 2. Recuperiamo e restituiamo i report ordinati per data di generazione
    return this.reportModel.find({ _id: { $in: reportIds } }).sort({ generatedAt: -1 }).lean().exec();
  }

  @Get(':id')
  async getReport(@Param('id') id: string, @CurrentUser() userId: string) {
    const report = await this.reportModel.findById(id).lean().exec();
    if (!report) {
      throw new NotFoundException('Report non trovato');
    }

    // Verifica permessi: la task associata deve appartenere all'utente
    const task = await this.taskModel.findOne({ _id: report.taskId, userId }).select('_id').lean().exec();
    if (!task) {
      throw new NotFoundException('Non sei autorizzato a visualizzare questo report o non esiste');
    }

    return report;
  }

  @Get(':id/export')
  async exportReport(
    @Param('id') id: string,
    @Query('format') format: string,
    @CurrentUser() userId: string,
    @Res() res: Response
  ) {
    // Riutilizziamo la logica sicura del metodo getReport
    const report = await this.getReport(id, userId);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="codeguardian-report-${id}.json"`);
      return res.send(JSON.stringify(report, null, 2));
    }

    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="codeguardian-report-${id}.md"`);
      
      // Costruisce un markdown di base secondo il contratto
      let md = `# Code Guardian Report\n\n`;
      md += `- **Operation:** ${report.operation}\n`;
      md += `- **Status:** ${report.status}\n`;
      md += `- **Generated:** ${new Date((report as any).generatedAt || Date.now()).toLocaleString()}\n\n`;
      md += `## Summary\n${report.summary || 'Nessun sommario disponibile.'}\n\n`;
      
      if (report.proposal) {
         md += `## Diff Proposal\n\`\`\`diff\n${report.proposal.diffUnified || ''}\n\`\`\`\n`;
      }

      if (report.body && report.body.length > 0) {
        md += `## Details\n\`\`\`json\n${JSON.stringify(report.body, null, 2)}\n\`\`\`\n`;
      }

      return res.send(md);
    }

    throw new BadRequestException("Formato di esportazione non supportato. Utilizza '?format=json' o '?format=md'");
  }
}