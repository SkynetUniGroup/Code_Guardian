import { Link } from '@tanstack/react-router';
import { useSessionStore } from '../../stores/sessionStore';

/**
 * Global warning banner shown at the top of the app shell when the user's
 * credentials have been marked as invalid.
 *
 * This is triggered globally by the WebSocket task.failed event with error code
 * CREDENTIAL_INVALID, which calls sessionStore.markCredentialsInvalid().
 *
 * The banner is sticky and must not obscure the main content — the AppShell
 * adds padding-top equal to the banner height when it is visible.
 */
export function CredentialBanner() {
  const status = useSessionStore((s) => s.credentialsStatus);

  // Only show when credentials are known to be invalid.
  if (status !== 'invalid') return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-[#cc2222] px-4 py-2 text-center text-sm text-white shadow-md">
      Le credenziali non sono più valide.{' '}
      <Link to="/credentials" className="font-semibold underline hover:no-underline">
        Aggiorna le credenziali
      </Link>{' '}
      per continuare ad usare il sistema.
    </div>
  );
}
