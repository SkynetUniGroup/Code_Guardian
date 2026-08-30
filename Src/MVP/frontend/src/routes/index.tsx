import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';

/**
 * Index route — /
 *
 * Immediately redirects based on authentication state:
 *  - Authenticated → /run
 *  - Unauthenticated → /login
 *
 * This is a navigation-only route; it renders no UI.
 */
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: ({ context }) => {
    if (context.session.isAuthenticated()) {
      throw redirect({ to: '/run' });
    }
    throw redirect({ to: '/login' });
  },
});
