import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { AuthenticatedUser } from "../common/authenticated-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import {
  ApiErrorResponse,
  CreateTaskBatchResponse,
  TaskResponse,
} from "../common/openapi/api-schemas";
import { CreateTaskBatchDto } from "./dto/create-task-batch.dto";
import { SubmitInputDto } from "./dto/submit-input.dto";
import { TaskDto } from "./dto/task.dto";
import { CreateTaskBatchResult, TasksService } from "./tasks.service";

@ApiTags("tasks")
@ApiBearerAuth()
@Controller("tasks")
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  // No @Roles() restriction here — a batch can mix operations from
  // different agents, so the permission check is per-operation, inside
  // TasksService, not a single role gate on the whole endpoint.
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Accoda un batch di operazioni su un contesto",
    description:
      "202 e non 201: i Task sono accodati, non eseguiti. Il permesso e' verificato per singola operazione, non sull'endpoint.",
  })
  @ApiAcceptedResponse({ type: CreateTaskBatchResponse })
  @ApiBadRequestResponse({
    description: "Corpo non valido o elenco vuoto.",
    type: ApiErrorResponse,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiForbiddenResponse({
    description: "Il ruolo di chi chiama non consente una delle operazioni richieste.",
    type: ApiErrorResponse,
  })
  @ApiNotFoundResponse({
    description: "Contesto inesistente o di un altro utente.",
    type: ApiErrorResponse,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTaskBatchDto,
  ): Promise<CreateTaskBatchResult> {
    return this.tasksService.createBatch(user, dto);
  }

  @Get()
  @ApiOperation({ summary: "I Task di chi chiama, dal piu' recente" })
  @ApiOkResponse({ type: [TaskResponse] })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  findAll(@CurrentUser("userId") userId: string): Promise<TaskDto[]> {
    return this.tasksService.findAllForUser(userId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Un Task: stato, avanzamento, errore, input atteso" })
  @ApiParam({ name: "id", description: "Id del Task." })
  @ApiOkResponse({ type: TaskResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description: "Task inesistente o di un altro utente.",
    type: ApiErrorResponse,
  })
  findOne(@CurrentUser("userId") userId: string, @Param("id") id: string): Promise<TaskDto> {
    return this.tasksService.findOneForUser(userId, id);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Annulla un Task",
    description: "Ammesso solo da PENDING o RUNNING: da uno stato terminale e' un 409.",
  })
  @ApiParam({ name: "id", description: "Id del Task." })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description: "Task inesistente o di un altro utente.",
    type: ApiErrorResponse,
  })
  @ApiConflictResponse({
    description: "Il Task ha gia' raggiunto uno stato terminale.",
    type: ApiErrorResponse,
  })
  cancel(@CurrentUser("userId") userId: string, @Param("id") id: string): Promise<void> {
    return this.tasksService.cancel(userId, id);
  }

  // BE-17: the counterpart to whatever pendingInput TaskProcessor last set —
  // one endpoint for all three kinds, since the frontend already models
  // them as a single discriminated union (PendingInput/SubmitInputDto),
  // rather than three near-duplicate routes.
  @Post(":id/input")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Risponde all'input che il Task sta aspettando",
    description:
      "Un solo endpoint per i tre kind, come nell'unione discriminata gia' usata dal frontend. Il kind inviato deve combaciare con quello atteso.",
  })
  @ApiParam({ name: "id", description: "Id del Task." })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: "Corpo non valido per il kind indicato.",
    type: ApiErrorResponse,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description: "Task inesistente o di un altro utente.",
    type: ApiErrorResponse,
  })
  @ApiConflictResponse({
    description: "Il Task non sta aspettando quell'input.",
    type: ApiErrorResponse,
  })
  submitInput(
    @CurrentUser("userId") userId: string,
    @Param("id") id: string,
    @Body() dto: SubmitInputDto,
  ): Promise<void> {
    return this.tasksService.submitInput(userId, id, dto);
  }
}
