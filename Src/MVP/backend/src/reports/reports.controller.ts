import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ReportSummaryDto } from './dto/report-summary.dto';
import { ReportDto } from './dto/report.dto';

// Every route here is personal to the caller — no RolesGuard, just proof of
// identity, same shape as TasksController/RepositoriesController: what a
// caller may see is already settled by which Reports carry their userId,
// not by their role.
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  findAll(
    @CurrentUser('userId') userId: string,
    @Query() query: ListReportsQueryDto,
  ): Promise<ReportSummaryDto[]> {
    return this.reportsService.findAllForUser(userId, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ): Promise<ReportDto> {
    return this.reportsService.findOneForUser(userId, id);
  }
}
