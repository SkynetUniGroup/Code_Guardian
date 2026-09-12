import { Controller, Get, UseGuards } from "@nestjs/common";
import type { UserRole } from "../auth/schemas/user.schema";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AgentRegistry } from "./agent-registry.service";
import type { OperationDescriptorDto } from "./agent-registry.types";

@Controller("operations")
export class OperationsController {
  constructor(private readonly agentRegistry: AgentRegistry) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@CurrentUser("role") role: UserRole): OperationDescriptorDto[] {
    return this.agentRegistry.getForRole(role);
  }
}
