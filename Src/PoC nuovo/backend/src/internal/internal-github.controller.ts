import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, NotFoundException, Param } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { HmacGuard } from '../common/guards/hmac.guard';
import { OctokitGitHubClient } from './github-client.service';
import { EventsGateway } from '../public/events.gateway.js';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, type TaskDocument } from '../domain/schemas/task.schema.js';

@ApiExcludeController() 
@Controller('internal')
@UseGuards(HmacGuard)
export class InternalGitHubController {
  constructor(
    private readonly githubClient: OctokitGitHubClient,
    private readonly eventsGateway: EventsGateway,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
  ) {}

  @Post('github/tree')
  @HttpCode(HttpStatus.OK)
  async readTree(@Body() req: { taskId: string; userId: string; owner: string; repo: string; sha: string }) {
    const nodes = await this.githubClient.getTree(req.taskId, req.userId, req.owner, req.repo, req.sha);
    return { nodes };
  }

  @Post('github/file')
  @HttpCode(HttpStatus.OK)
  async readFile(@Body() req: { taskId: string; userId: string; owner: string; repo: string; sha: string; path: string }) {
    try {
      const result = await this.githubClient.getFileContent(req.taskId, req.userId, req.owner, req.repo, req.sha, req.path);
      return result;
    } catch (error) {
      throw new NotFoundException(`File non trovato o inaccessibile: ${req.path}`);
    }
  }

  @Post('github/issues')
  @HttpCode(HttpStatus.OK)
  async readIssues(@Body() req: { taskId: string; userId: string; owner: string; repo: string; filter?: any }) {
    const issues = await this.githubClient.listIssues(req.taskId, req.userId, req.owner, req.repo, req.filter);
    return { issues };
  }

  @Post('tasks/:id/progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateProgress(
    @Body() req: { stage: string; percent: number },
    @Param('id') taskId: string
  ) {
    const task = await this.taskModel.findByIdAndUpdate(
      taskId,
      {
        $set: {
          progressPercent: req.percent,
          currentStage: req.stage,
        },
      },
      { new: true, select: 'userId' } // Restituisce il doc aggiornato, selezionando solo lo userId che ci serve per l'evento
    ).lean().exec();

    // Inoltra l'evento via WebSocket al frontend
    this.eventsGateway.emitTaskProgress(taskId, req.stage, req.percent, task?.userId);
    return;
  }
}