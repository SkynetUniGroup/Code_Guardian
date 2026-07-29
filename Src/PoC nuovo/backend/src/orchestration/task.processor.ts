import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, type TaskDocument } from '../domain/schemas/task.schema.js';
import { Report, type ReportDocument } from '../domain/schemas/report.schema.js';
import { AnalysisContext, type AnalysisContextDocument } from '../domain/schemas/analysis-context.schema.js';
import { AgentRegistry } from './agent.registry.js';
import { AgentGatewayService } from './agent-gateway.service.js';
import { EventsGateway } from '../public/events.gateway.js';

@Processor('tasks')
export class TaskProcessor extends WorkerHost {
  private readonly logger = new Logger(TaskProcessor.name);

  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Report.name) private reportModel: Model<ReportDocument>,
    @InjectModel(AnalysisContext.name) private contextModel: Model<AnalysisContextDocument>,
    private readonly registry: AgentRegistry,
    private readonly gateway: AgentGatewayService,
    private readonly eventsGateway: EventsGateway,
  ) {super();}

  async process(job: Job<{ taskId: string }>): Promise<void> {
    const { taskId } = job.data;
    this.logger.log(`Inizio elaborazione Task ${taskId}`);

    const task = await this.taskModel.findById(taskId);
    if (!task) {
      this.logger.error(`Task ${taskId} non trovata`);
      return;
    }

    // Rispetta il ciclo di vita (Figura 8)[cite: 1]
    if (!task.canTransitionTo('RUNNING')) {
      this.logger.warn(`Transizione a RUNNING non permessa per la task ${taskId} (stato attuale: ${task.status})`);
      return;
    }

    task.status = 'RUNNING';
    await task.save();

    const context = await this.contextModel.findById(task.contextId);
    if (!context) {
      this.logger.error(`Contesto di analisi non trovato per la Task ${taskId}`);
      task.status = 'FAILED';
      task.error = { code: 'CONTEXT_MISSING', message: 'Contesto non trovato nel DB', stage: 'init' };
      await task.save();
      return;
    }
    const descriptor = this.registry.getByOperationCode(task.operation);

    let reportData: any;

    try {
      // Costruisce il payload. `userId` è fondamentale per permettere all'agente di autenticare le chiamate HMAC ai tool
      const payload = {
        userId: task.userId, 
        context_ref: {
          repoOwner: context.repoOwner,
          repoName: context.repoName,
          ref: context.resolvedSha,
          scopeType: context.scopeType,
          paths: context.paths,
        }
      };

      // Invocazione verso il servizio agenti Python. Attendiamo la fine del grafo.
      reportData = await this.gateway.invokeAgent(descriptor, payload);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Errore durante l'esecuzione dell'agente per Task ${taskId}: ${errorMessage}`);
      
      reportData = {
        agentId: descriptor.agentId,
        operation: descriptor.operation,
        status: 'FAILED',
        error: { kind: 'UPSTREAM', message: errorMessage, stage: 'agent_invocation' },
        body: [],
      };
    }

    // Salva il contratto di output condiviso su MongoDB
    const report = new this.reportModel({
      taskId: task._id,
      agentId: reportData.agentId || descriptor.agentId,
      operation: reportData.operation || descriptor.operation,
      status: reportData.status || 'COMPLETED',
      durationMs: reportData.durationMs || 0,
      tokensConsumed: reportData.tokensConsumed || 0,
      summary: reportData.summary || '',
      error: reportData.error || null,
      body: reportData.body || reportData.blocks || [],
      proposal: reportData.proposal || null,
    });
    const savedReport = await report.save();

    // Aggiorna lo stato finale della task
    task.status = report.status === 'FAILED' ? 'FAILED' : 'COMPLETED';
    task.reportId = savedReport._id;
    task.progressPercent = 100;
    task.finishedAt = new Date();
    await task.save();

    if (task.status === 'FAILED') {
   this.eventsGateway.emitTaskFailed(taskId, task.error || reportData.error, task.userId);
}

this.eventsGateway.emitTaskUpdated(taskId, task.status, savedReport._id.toString(), task.userId);
    
    const pendingOrRunningCount = await this.taskModel.countDocuments({
      batchId: task.batchId,
      status: { $in: ['PENDING', 'RUNNING'] }
    });

    if (pendingOrRunningCount === 0) {
      const completedCount = await this.taskModel.countDocuments({ batchId: task.batchId, status: 'COMPLETED' });
      const failedCount = await this.taskModel.countDocuments({ batchId: task.batchId, status: 'FAILED' });
      
      this.eventsGateway.emitBatchCompleted(task.batchId, completedCount, failedCount, task.userId);
      this.logger.log(`Batch ${task.batchId} completato. Successi: ${completedCount}, Fallimenti: ${failedCount}`);
    }
    
    this.logger.log(`Elaborazione Task ${taskId} conclusa con stato ${task.status}`);
  }
}