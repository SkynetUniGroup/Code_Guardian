import { UserRole } from '../auth/schemas/user.schema';

// What ends up on request.user once JwtAuthGuard has run — read by
// RolesGuard and the @CurrentUser() decorator alike, so both stay in sync
// with whatever JwtStrategy actually puts there.
export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
}
