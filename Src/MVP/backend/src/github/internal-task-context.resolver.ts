import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import {
  AnalysisContext,
  AnalysisContextDocument,
} from '../contexts/schemas/analysis-context.schema';
import { CredentialsService } from '../credentials/credentials.service';

export interface ResolvedTaskContext {
  taskId: string;
  owner: string;
  repo: string;
  resolvedSha: string;
  token: string;
}

// The one piece of new logic BE-8 actually needed: the agent only knows
// which task it's executing, not which repository, commit, or credential
// that implies. Kept separate from InternalGithubController so this
// resolution step — and its failure modes — can be tested without also
// standing up the controller and its guard.
@Injectable()
export class InternalTaskContextResolver {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(AnalysisContext.name)
    private readonly contextModel: Model<AnalysisContextDocument>,
    private readonly credentials: CredentialsService,
  ) {}

  async resolve(taskId: string): Promise<ResolvedTaskContext> {
    const task = await this.taskModel.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    const context = await this.contextModel.findById(task.contextId);
    if (!context) {
      throw new NotFoundException(
        `AnalysisContext ${task.contextId.toString()} not found for task ${taskId}`,
      );
    }

    const token = await this.credentials.getDecryptedToken(
      task.userId,
      'GITHUB',
    );

    return {
      taskId,
      owner: context.repoOwner,
      repo: context.repoName,
      resolvedSha: context.resolvedSha,
      token,
    };
  }
}
