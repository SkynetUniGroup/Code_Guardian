import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../authenticated-user';
import { UserRole } from '../../auth/schemas/user.schema';

// Must run after JwtAuthGuard — e.g. @UseGuards(JwtAuthGuard, RolesGuard) —
// since it reads request.user, which only JwtAuthGuard populates. No
// database lookup here: the role already travels in the token.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      UserRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    // No @Roles() on this route at all: nothing to enforce.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();

    if (!requiredRoles.includes(request.user?.role as UserRole)) {
      throw new ForbiddenException(
        'Your role is not allowed to perform this action',
      );
    }

    return true;
  }
}
