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
  @ApiProperty({ type: String, description: "Id of an AnalysisContext created with POST /contexts." })
  @IsMongoId()
  contextId!: string;

  @ApiProperty({
    enum: OPERATION_CODES,
    isArray: true,
    description: "At least one. Duplicates are removed by the service, not rejected.",
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(OPERATION_CODES, { each: true })
  operations!: OperationCode[];
}
