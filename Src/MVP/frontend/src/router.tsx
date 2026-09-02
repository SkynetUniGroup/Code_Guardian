import { createRouter, RouterProvider } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { useSessionStore } from './stores/sessionStore';

/**
 * Router instance.
 *
 * The router context is typed as RouterContext (see routes/root.tsx) and
 * receives a live reference to the sessionStore on every render. This allows
 * beforeLoad guards to read isAuthenticated() and credentialsStatus
 * synchronously without introducing component-level state.
 *
 * The `!` in `session: null!` is the TanStack Router convention for
 * initialising context with a placeholder that will be replaced at runtime.
 */
const router = createRouter({
  routeTree,
  context: { session: null! },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  defaultErrorComponent: ({ error }) => (
    <div className="flex items-center justify-center min-h-screen text-sm text-red-600 p-4">
      Errore inatteso: {error.message}
    </div>
  ),
});

/**
 * Router component.
 * Reads the sessionStore and injects it into the router context on every render
 * so that route guards always see the latest authentication state.
 */
export function Router() {
  const session = useSessionStore();
  return <RouterProvider router={router} context={{ session }} />;
}
