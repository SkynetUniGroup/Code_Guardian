import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../../auth/schemas/user.schema';

class DummyController {
  @Roles('SECURITY_AUDITOR')
  restricted(this: void) {}

  open(this: void) {}
}

// Referenced off the prototype, never called: what matters for this test is
// the function object @Roles() attached its metadata to, not an instance to
// invoke it on. Wrapping these in a new arrow function instead would lose
// that metadata entirely and make every case look like "no roles required".
const restrictedHandler = DummyController.prototype.restricted;
const openHandler = DummyController.prototype.open;

function makeContext(
  role: UserRole | undefined,
  handler: () => void,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => DummyController,
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { userId: 'u1', role } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows the request when the route has no @Roles() at all', () => {
    expect(guard.canActivate(makeContext('DEVELOPER', openHandler))).toBe(true);
  });

  it('allows the request when the caller has one of the required roles', () => {
    expect(
      guard.canActivate(makeContext('SECURITY_AUDITOR', restrictedHandler)),
    ).toBe(true);
  });

  it('rejects the request when the caller does not have a required role', () => {
    expect(() =>
      guard.canActivate(makeContext('DEVELOPER', restrictedHandler)),
    ).toThrow(ForbiddenException);
  });
});
