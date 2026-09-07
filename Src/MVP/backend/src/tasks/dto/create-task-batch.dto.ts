import {
  type CreateTaskBatchDto as CreateTaskBatchDtoInterface,
  OPERATION_CODES,
  type OperationCode,
} from "@codeguardian/shared";
import { ArrayNotEmpty, IsArray, IsIn, IsMongoId } from "class-validator";

// Body of POST /tasks. Deduplication of `operations` happens in
// TasksService, not here — class-validator flags invalid codes, but "the
// same valid code twice" isn't a validation failure, it's a normalization
// step the service performs before the checks in §7.3 run.
export class CreateTaskBatchDto implements CreateTaskBatchDtoInterface {
  @IsMongoId()
  contextId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(OPERATION_CODES, { each: true })
  operations!: OperationCode[];
}
