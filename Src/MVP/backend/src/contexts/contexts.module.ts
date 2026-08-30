import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AnalysisContext,
  AnalysisContextSchema,
} from './schemas/analysis-context.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AnalysisContext.name, schema: AnalysisContextSchema },
    ]),
  ],
  // Re-exported for the same reason as TasksModule: BE-8's internal GitHub
  // facade needs to read an AnalysisContext by id to resolve which
  // repository/commit a task's reads belong to.
  exports: [MongooseModule],
})
export class ContextsModule {}
