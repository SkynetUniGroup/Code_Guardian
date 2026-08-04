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
  ) { 
    super(); 
  }

  async process(job: Job<{ taskId: string }>): Promise<void> {
    const { taskId } = job.data;
    this.logger.log(`Inizio elaborazione Task ${taskId}`);

    const task = await this.taskModel.findById(taskId);
    if (!task) {
      this.logger.error(`Task ${taskId} non trovata`);
      return;
    }

    // Rispetta il ciclo di vita 
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
      
      this.eventsGateway.emitTaskFailed(taskId, task.error, task.userId);
      this.eventsGateway.emitTaskUpdated(taskId, 'FAILED', undefined, task.userId);
      await this._checkAndEmitBatchCompletion(task.batchId, task.userId);
      
      return;
    }
    const descriptor = this.registry.getByOperationCode(task.operation);

    let reportData: any;

    try {
      const payload = {
        taskId: task._id.toString(), 
        userId: task.userId, 
        operation: task.operation,
        context_ref: {
          repoOwner: context.repoOwner,
          repoName: context.repoName,
          ref: context.resolvedSha,
          scopeType: context.scopeType,
          paths: context.paths,
          sprint_id: (context as any).sprintId || "Sprint Attuale",
        }
      };

      reportData = await this.gateway.invokeAgent(descriptor, payload);

      if (reportData?.status === 'CANCELLED') {
        this.logger.log(`Task ${taskId} cancellata cooperativamente dall'agente.`);
        const currentTask = await this.taskModel.findById(taskId);
        if (currentTask && currentTask.canTransitionTo('CANCELLED')) {
          currentTask.status = 'CANCELLED';
          currentTask.finishedAt = new Date();
          await currentTask.save();
          this.eventsGateway.emitTaskUpdated(taskId, 'CANCELLED', undefined, currentTask.userId);
          
          // Esecuzione controllo completamento batch anche su ramo CANCELLED
          await this._checkAndEmitBatchCompletion(currentTask.batchId, currentTask.userId);
        }
        return;
      }

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

    const currentTask = await this.taskModel.findById(taskId);
    if (!currentTask) return;

    const nextStatus = report.status === 'FAILED' ? 'FAILED' : 'COMPLETED';
    
    if (!currentTask.canTransitionTo(nextStatus)) {
      this.logger.warn(`Task ${taskId} non può transire a ${nextStatus} (stato attuale: ${currentTask.status}). Esito scartato.`);
      return; 
    }

    currentTask.status = nextStatus;
    currentTask.reportId = savedReport._id;
    currentTask.progressPercent = 100;
    currentTask.finishedAt = new Date();
    currentTask.error = reportData.error || null; 
    await currentTask.save();

    if (currentTask.status === 'FAILED') {
      this.eventsGateway.emitTaskFailed(taskId, currentTask.error, currentTask.userId);
    }
    this.eventsGateway.emitTaskUpdated(taskId, currentTask.status, savedReport._id.toString(), currentTask.userId);
    
    // Esecuzione controllo completamento batch sul flusso standard
    await this._checkAndEmitBatchCompletion(currentTask.batchId, currentTask.userId);
    
    this.logger.log(`Elaborazione Task ${taskId} conclusa con stato ${currentTask.status}`);
  }

  private async _checkAndEmitBatchCompletion(batchId: string, userId: string): Promise<void> {
    const pendingOrRunningCount = await this.taskModel.countDocuments({
      batchId: batchId,
      status: { $in: ['PENDING', 'RUNNING'] }
    });

    if (pendingOrRunningCount === 0) {
      const completedCount = await this.taskModel.countDocuments({ batchId, status: 'COMPLETED' });
      const failedCount = await this.taskModel.countDocuments({ 
        batchId, 
        status: { $in: ['FAILED', 'CANCELLED'] } 
      });
      
      this.eventsGateway.emitBatchCompleted(batchId, completedCount, failedCount, userId);
      this.logger.log(`Batch ${batchId} completato. Successi: ${completedCount}, Falliti/Annullati: ${failedCount}`);
    }
  }
}