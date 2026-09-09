import { Controller, Get, Param, Query, Res, UseGuards } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OPERATION_CODES } from "../common/domain-types";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import {
  ApiErrorResponse,
  ReportResponse,
  ReportSummaryResponse,
} from "../common/openapi/api-schemas";
import { ExportReportQueryDto } from "./dto/export-report-query.dto";
import { ListReportsQueryDto } from "./dto/list-reports-query.dto";
import { ReportDto } from "./dto/report.dto";
import { ReportSummaryDto } from "./dto/report-summary.dto";
import { ReportsService } from "./reports.service";
import { ReportsExportService } from "./reports-export.service";

// Every route here is personal to the caller — no RolesGuard, just proof of
// identity, same shape as TasksController/RepositoriesController: what a
// caller may see is already settled by which Reports carry their userId,
// not by their role.
@ApiTags("reports")
@ApiBearerAuth()
@Controller("reports")
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportsExportService: ReportsExportService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "I report di chi chiama",
    description:
      "Forma ridotta: senza corpo, proposta o errore, per non trascinare un Block[] intero per riga di elenco.",
  })
  @ApiQuery({ name: "operation", required: false, enum: OPERATION_CODES })
  @ApiQuery({
    name: "from",
    required: false,
    description: "ISO 8601, estremo inferiore su generatedAt.",
  })
  @ApiQuery({
    name: "to",
    required: false,
    description: "ISO 8601, estremo superiore su generatedAt.",
  })
  @ApiOkResponse({ type: [ReportSummaryResponse] })
  @ApiBadRequestResponse({ description: "Filtri non validi.", type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  findAll(
    @CurrentUser("userId") userId: string,
    @Query() query: ListReportsQueryDto,
  ): Promise<ReportSummaryDto[]> {
    return this.reportsService.findAllForUser(userId, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Un report per intero" })
  @ApiParam({ name: "id", description: "Id del report." })
  @ApiOkResponse({ type: ReportResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description: "Report inesistente o di un altro utente.",
    type: ApiErrorResponse,
  })
  findOne(@CurrentUser("userId") userId: string, @Param("id") id: string): Promise<ReportDto> {
    return this.reportsService.findOneForUser(userId, id);
  }

  // BE-20: @Res() in raw mode (no {passthrough: true}) — this handler needs
  // to send a binary PDF, an empty 409, or a bespoke error JSON depending on
  // outcome, none of which fits returning a single typed value the way
  // every other route on this controller does. See ReportsExportService for
  // why.
  @Get(":id/export")
  @ApiOperation({
    summary: "Esporta un report in PDF",
    description: "Il parametro `format` e' obbligatorio: senza, la richiesta e' un 400.",
  })
  @ApiParam({ name: "id", description: "Id del report." })
  @ApiQuery({
    name: "format",
    required: true,
    enum: ["pdf"],
    description: "Oggi 'pdf' e' l'unico valore ammesso.",
  })
  @ApiProduces("application/pdf")
  @ApiOkResponse({
    description: "Il PDF del report.",
    content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
  })
  @ApiBadRequestResponse({
    description: "format mancante o diverso da 'pdf'.",
    type: ApiErrorResponse,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description: "Report inesistente o di un altro utente.",
    type: ApiErrorResponse,
  })
  @ApiConflictResponse({
    description: "Report non ancora esportabile.",
    type: ApiErrorResponse,
  })
  async export(
    @CurrentUser("userId") userId: string,
    @Param("id") id: string,
    @Query() _query: ExportReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.reportsExportService.export(userId, id, res);
  }
}
