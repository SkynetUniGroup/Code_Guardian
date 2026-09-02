import { createRoute } from '@tanstack/react-router';
import { authRoute } from './_auth';
import { CredentialsPage } from '../pages/CredentialsPage';

/**
 * Credentials route — /credentials (authenticated)
 *
 * Accessible by all authenticated users regardless of credentials status.
 * This is the page that FIXES invalid/missing credentials, so it must not
 * be blocked by the credential guard.
 */
export const credentialsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/credentials',
  component: CredentialsPage,
});
