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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AnalysisContext.name, schema: AnalysisContextSchema },
    ]),
    CredentialsModule,
    GithubModule,
  ],
  controllers: [RepositoriesController],
  // RepoResolverService is exported too: POST /contexts (BE-11) needs the
  // exact same URL-resolution step and shouldn't reimplement it.
  providers: [RepositoriesService, RepoResolverService],
  // MongooseModule re-exported for the same reason as TasksModule: BE-8's
  // internal GitHub facade needs to read an AnalysisContext by id to resolve
  // which repository/commit a task's reads belong to.
  exports: [MongooseModule, RepoResolverService],
})
export class ContextsModule {}
