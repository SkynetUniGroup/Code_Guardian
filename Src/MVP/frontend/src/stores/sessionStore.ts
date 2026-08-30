import { create } from 'zustand';
import type { AuthUser, CredentialsStatus } from '../types';

/**
 * Shape of the session state slice (data only).
 */
interface SessionState {
  /** The authenticated user, or null when logged out. */
  user: AuthUser | null;

  /**
   * JWT access token held exclusively in memory.
   * NEVER written to localStorage or sessionStorage — the security spec
   * requires that the token is wiped on page refresh.
   */
  token: string | null;

  /**
   * Reflects the last known state of the user's stored credentials
   * (GitHub PAT + OpenAI key). Drives route guards for /select and /run.
   */
  credentialsStatus: CredentialsStatus;
}

/**
 * Shape of the session action slice (mutations).
 */
interface SessionActions {
  /** Returns true when the user has an active JWT token in memory. */
  isAuthenticated: () => boolean;

  /** Stores user data and JWT after a successful login or registration. */
  login: (user: AuthUser, token: string) => void;

  /** Clears all auth state, effectively logging the user out. */
  logout: () => void;

  /** Updates the credentials status (called after GET /credentials or a WS error). */
  setCredentialsStatus: (status: CredentialsStatus) => void;

  /**
   * Marks credentials as invalid — called globally when the WebSocket receives
   * a task.failed event with error code CREDENTIAL_INVALID. Also triggers
   * a UI-level banner and a redirect to /credentials.
   */
  markCredentialsInvalid: () => void;
}

export type SessionStore = SessionState & SessionActions;

/**
 * Global session store.
 * Single source of truth for authentication state and credentials status.
 * The JWT is held in Zustand memory only (not in any Web Storage API).
 */
export const useSessionStore = create<SessionStore>((set, get) => ({
  // ---- Initial state ----
  user: null,
  token: null,
  credentialsStatus: 'unknown',

  // ---- Actions ----

  isAuthenticated: () => get().token !== null,

  login: (user, token) => {
    set({ user, token });
  },

  logout: () => {
    set({ user: null, token: null, credentialsStatus: 'unknown' });
  },

  setCredentialsStatus: (status) => {
    set({ credentialsStatus: status });
  },

  markCredentialsInvalid: () => {
    set({ credentialsStatus: 'invalid' });
  },
}));
