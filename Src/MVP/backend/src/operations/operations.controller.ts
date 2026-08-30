import { Controller, Get } from '@nestjs/common';
import { UserRole } from '../auth/schemas/user.schema';
import { AgentRegistry } from './agent-registry.service';
import { OperationDescriptorDto } from './agent-registry.types';

@Controller('operations')
export class OperationsController {
  constructor(private readonly agentRegistry: AgentRegistry) {}

  @Get()
  findAll(): OperationDescriptorDto[] {
    // TODO(BE-4): read the real role from the JWT once JwtAuthGuard/RolesGuard
    // exist, e.g. via a @CurrentUser() decorator reading req.user.role.
    // Hardcoded for now so this endpoint has its real shape and the frontend
    // can integrate against it before auth lands — swap this one line.
    const callerRole: UserRole = 'DEVELOPER';
    return this.agentRegistry.getForRole(callerRole);
  }
}
