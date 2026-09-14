import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

// Query params for GET /reports/:id/export. 'pdf' is the only format the
// issue defines — an unsupported value is a plain 400 via the global
// ValidationPipe, same as anywhere else in this API.
export class ExportReportQueryDto {
  @ApiProperty({
    enum: ["pdf"],
    description:
      "Obbligatorio: senza, la richiesta e' un 400. 'pdf' e' oggi l'unico formato previsto.",
  })
  @IsIn(["pdf"])
  format!: "pdf";
}
