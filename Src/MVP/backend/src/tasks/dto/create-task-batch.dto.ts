import {
  type CreateTaskBatchDto as CreateTaskBatchDtoInterface,
  OPERATION_CODES,
  type OperationCode,
} from "@codeguardian/shared";
import { ApiProperty } from "@nestjs/swagger";
import { ArrayNotEmpty, IsArray, IsIn, IsMongoId } from "class-validator";

// Body of POST /tasks. Deduplication of `operations` happens in
// TasksService, not here — class-validator flags invalid codes, but "the
// same valid code twice" isn't a validation failure, it's a normalization
// step the service performs before the checks in §7.3 run.
export class CreateTaskBatchDto implements CreateTaskBatchDtoInterface {
  @ApiProperty({ type: String, description: "Id di un AnalysisContext creato con POST /contexts." })
  @IsMongoId()
  contextId!: string;

  @ApiProperty({
    enum: OPERATION_CODES,
    isArray: true,
    description: "Almeno una. I duplicati sono rimossi dal servizio, non rifiutati.",
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(OPERATION_CODES, { each: true })
  operations!: OperationCode[];
}
