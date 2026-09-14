import { Controller, Get, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { UserRole } from "../auth/schemas/user.schema";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ApiErrorResponse, OperationDescriptorResponse } from "../common/openapi/api-schemas";
import { AgentRegistry } from "./agent-registry.service";
import type { OperationDescriptorDto } from "./agent-registry.types";

@ApiTags("operations")
@Controller("operations")
export class OperationsController {
  constructor(private readonly agentRegistry: AgentRegistry) {}

  @Get()
/**
 * @swagger
 * /operations:
 *   get:
 *     summary: Le operazioni consentite al ruolo di chi chiama
 *     description: Gia' filtrate dal backend: e' la fonte di verita' su quali operazioni esistono e chi puo' lanciarle.
 *     operationId: findAll
 *     responses:
 *       200:
 *         description: List of available operations for the user's role
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/OperationDescriptorResponse'
 *       401:
 *         description: Unauthorized access
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Le operazioni consentite al ruolo di chi chiama",
    description:
      "Gia' filtrate dal backend: e' la fonte di verita' su quali operazioni esistono e chi puo' lanciarle.",
  })
  @ApiOkResponse({ type: [OperationDescriptorResponse] })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  findAll(@CurrentUser("role") role: UserRole): OperationDescriptorDto[] {
    return this.agentRegistry.getForRole(role);
  }
}
