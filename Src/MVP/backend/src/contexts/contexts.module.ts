import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CredentialsModule } from '../credentials/credentials.module';
import { GithubModule } from '../github/github.module';
import {
  AnalysisContext,
  AnalysisContextSchema,
} from './schemas/analysis-context.schema';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { RepoResolverService } from './repo-resolver.service';
import { ContextsController } from './contexts.controller';
import { ContextsService } from './contexts.service';
import { francProvider } from './franc.provider';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AnalysisContext.name, schema: AnalysisContextSchema },
    ]),
    CredentialsModule,
    GithubModule,
  ],
  controllers: [RepositoriesController, ContextsController],
  providers: [
    RepositoriesService,
    RepoResolverService,
    ContextsService,
    francProvider,
  ],
  // MongooseModule re-exported for the same reason as TasksModule: BE-8's
  // internal GitHub facade needs to read an AnalysisContext by id to resolve
  // which repository/commit a task's reads belong to.
  exports: [MongooseModule, RepoResolverService],
})
export class ContextsModule {}
