import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { SessionStore } from '../stores/sessionStore';

/**
 * Router context type — injected via RouterProvider so every route's
 * beforeLoad handler can access the session store synchronously.
 */
export interface RouterContext {
  session: SessionStore;
}

/**
 * Root route — wraps the entire route tree.
 * No layout component here; the AppShell is rendered by the authenticated
 * layout route (_auth) so public routes (login, register) remain undecorated.
 */
export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
});
