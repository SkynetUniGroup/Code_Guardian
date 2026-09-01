import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Report, ReportSchema } from './schemas/report.schema';
import {
  AnalysisContext,
  AnalysisContextSchema,
} from '../contexts/schemas/analysis-context.schema';
import { OperationsModule } from '../operations/operations.module';
import { ReportAssemblyService } from './report-assembly.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Report.name, schema: ReportSchema },
      // Registered directly here rather than importing ContextsModule, same
      // reasoning as TasksModule's own AnalysisContext registration: this
      // module only needs the model, for ReportAssemblyService's
      // denormalization read, not ContextsModule's controllers/services.
      { name: AnalysisContext.name, schema: AnalysisContextSchema },
    ]),
    OperationsModule,
  ],
  providers: [ReportAssemblyService],
  // MongooseModule re-exported for BE-19/BE-20 to inject Model<Report>
  // directly, same pattern TasksModule already uses for Model<Task>.
  exports: [MongooseModule, ReportAssemblyService],
})
export class ReportsModule {}
