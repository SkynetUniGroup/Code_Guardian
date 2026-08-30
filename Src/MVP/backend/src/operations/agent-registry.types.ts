import { OperationCode } from '../common/domain-types';
import { UserRole } from '../auth/schemas/user.schema';

export type AgentName = 'DOCS' | 'SECURITY' | 'CHANGELOG';

// What GET /operations actually returns — no allowedRoles here, that's an
// internal filtering detail, never sent to the client.
export interface OperationDescriptorDto {
  code: OperationCode;
  displayName: string;
  description: string;
  agent: AgentName;
}

// The registry's own entries carry one field the DTO doesn't: allowedRoles,
// used to filter before the response is built.
export interface AgentRegistryEntry extends OperationDescriptorDto {
  allowedRoles: UserRole[];
}
