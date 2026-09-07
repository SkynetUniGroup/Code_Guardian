import { createRoute, redirect } from '@tanstack/react-router';
import { authRoute } from './_auth';
import { RunPage } from '../pages/RunPage';

/**
 * Run route — /run (authenticated + credentials required)
 *
 * Launching an operation requires valid credentials. Users with missing or
 * invalid credentials are redirected to /credentials.
 */
export const runRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/run',
  beforeLoad: ({ context }) => {
    const status = context.session.credentialsStatus;
    if (status === 'missing' || status === 'invalid') {
      throw redirect({ to: '/credentials' });
    }
  },
  component: RunPage,
});
