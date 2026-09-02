import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../auth/schemas/user.schema';

export const ROLES_KEY = 'roles';

// Marks a route with the roles allowed to call it — read by RolesGuard.
// A route with no @Roles() at all is left alone: RolesGuard only enforces
// where this decorator is actually present.
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
