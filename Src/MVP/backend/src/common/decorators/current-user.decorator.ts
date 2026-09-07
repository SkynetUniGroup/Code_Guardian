import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../authenticated-user';

// @CurrentUser() returns the whole { userId, role } object;
// @CurrentUser('role') returns just that one field.
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    return field ? request.user?.[field] : request.user;
  },
);
