import { Controller, Get, UseGuards } from '@nestjs/common';
import type { UserRole } from '../auth/schemas/user.schema';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AgentRegistry } from './agent-registry.service';
import { OperationDescriptorDto } from './agent-registry.types';

@Controller('operations')
export class OperationsController {
  constructor(private readonly agentRegistry: AgentRegistry) {}

  @Get()
/**
 * @swagger
 * /operations:
 *   get:
 *     summary: Retrieve all available operations for the current user's role
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: ['agent', 'admin']
 *         description: The role of the current user.
 *     responses:
 *       200:
 *         description: A list of available operation descriptors for the user's role.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/OperationDescriptorDto'
 *       401:
 *         description: Unauthorized - the request lacks valid authentication credentials.
 *       500:
 *         description: Internal server error occurred while fetching operations.
 */
  @UseGuards(JwtAuthGuard)
  findAll(@CurrentUser('role') role: UserRole): OperationDescriptorDto[] {
    return this.agentRegistry.getForRole(role);
  }
}
