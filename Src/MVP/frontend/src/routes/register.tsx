import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { RegisterPage } from '../pages/RegisterPage';

/**
 * Register route — /register (public)
 *
 * Redirects authenticated users to /run; an already-logged-in user
 * should not be able to create a new account from within the session.
 */
export const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  beforeLoad: ({ context }) => {
    if (context.session.isAuthenticated()) {
      throw redirect({ to: '/run' });
    }
  },
  component: RegisterPage,
});
