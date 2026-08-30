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
})
export class ContextsModule {}
