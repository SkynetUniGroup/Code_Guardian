import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Report, ReportSchema } from './schemas/report.schema.ts';
import { ReportService } from './report.service.ts';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
  ],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}