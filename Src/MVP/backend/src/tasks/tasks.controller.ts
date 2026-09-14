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
/**
 * @swagger
 * /tasks:
 *   post:
 *     summary: Accoda un batch di operazioni su un contesto
 *     description: 202 e non 201: i Task sono accodati, non eseguiti. Il permesso e' verificato per singola operazione, non sull'endpoint.
 *     operationId: create
 *     responses:
 *       202:
 *         description: Task batch created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CreateTaskBatchResponse'
 *       400:
 *         description: Corpo non valido o elenco vuoto
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       401:
 *         description: Unauthorized access
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Il ruolo di chi chiama non consente una delle operazioni richieste
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Contesto inesistente o di un altro utente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
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
/**
 * @swagger
 * /tasks:
 *   get:
 *     summary: I Task di chi chiama, dal piu' recente
 *     operationId: findAll
 *     responses:
 *       200:
 *         description: Lista di task per l'utente
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/TaskResponse'
 *       401:
 *         description: Unauthorized access
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
  @ApiOperation({ summary: "I Task di chi chiama, dal piu' recente" })
  @ApiOkResponse({ type: [TaskResponse] })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  findAll(@CurrentUser("userId") userId: string): Promise<TaskDto[]> {
    return this.tasksService.findAllForUser(userId);
  }

  @Get(":id")
/**
 * @swagger
 * /tasks/{id}:
 *   get:
 *     summary: Un Task: stato, avanzamento, errore, input atteso
 *     operationId: findOne
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Id del Task.
 *     responses:
 *       200:
 *         description: Detailed task information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TaskResponse'
 *       401:
 *         description: Unauthorized access
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Task inesistente o di un altro utente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
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
/**
 * @swagger
 * /tasks/{id}/cancel:
 *   post:
 *     summary: Annulla un Task
 *     description: Ammesso solo da PENDING o RUNNING: da uno stato terminale e' un 409.
 *     operationId: cancel
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Id del Task.
 *     responses:
 *       204:
 *         description: No content returned
 *       401:
 *         description: Unauthorized access
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Task inesistente o di un altro utente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Il Task ha gia' raggiunto uno stato terminale
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
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
/**
 * @swagger
 * /tasks/{id}/input:
 *   post:
 *     summary: Risponde all'input che il Task sta aspettando
 *     description: Un solo endpoint per i tre kind, come nell'unione discriminata gia' usata dal frontend. Il kind inviato deve combaciare con quello atteso.
 *     operationId: submitInput
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Id del Task.
 *     responses:
 *       204:
 *         description: No content returned
 *       400:
 *         description: Corpo non valido per il kind indicato
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       401:
 *         description: Unauthorized access
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Task inesistente o di un altro utente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Il Task non sta aspettando quell'input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
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
