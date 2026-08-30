import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { AppShell } from '../components/layout/AppShell';

/**
 * Authenticated layout route — pathless, id="_auth"
 *
 * All routes that require authentication are nested under this route.
 * The route guard runs synchronously (beforeLoad reads from the in-memory
 * sessionStore via context) so unauthenticated users are redirected
 * before any child component mounts.
 *
 * The component wraps children with the AppShell (sidebar, header, WS hook).
 */
export const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_auth',
  beforeLoad: ({ context, location }) => {
    if (!context.session.isAuthenticated()) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      });
    }
  },
  component: AppShell,
});
