import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { useSessionStore } from '../stores/sessionStore';

/**
 * Base URL for all API calls.
 * MUST be a relative path (e.g. /api/v1) so that the browser targets the same
 * origin as the frontend (CloudFront handles routing). Never set an absolute URL
 * with a hardcoded domain — that would break the same-origin constraint and
 * require CORS configuration.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/** Singleton axios instance shared across the entire application. */
export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  // Ensure cookies/credentials are not sent automatically — auth is JWT-only.
  withCredentials: false,
});

/**
 * Injects the Authorization header from the sessionStore before each request.
 * The token is read at request time via getState() so it is always current,
 * whether the user just logged in or refreshed their session.
 */
apiClient.interceptors.request.use((config) => {
  const token: string | null = useSessionStore.getState().token;

  if (token) {
    config.headers = config.headers ?? {};
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

/**
 * Convenience wrapper that performs a streaming GET request and returns a Blob.
 * Used exclusively for PDF export (GET /reports/:id/export?format=pdf).
 * We bypass the axios instance for streaming because axios buffers responses
 * internally, whereas the fetch API supports true streaming.
 *
 * @param path - The relative API path (e.g. "/reports/abc123/export?format=pdf")
 * @param token - The current JWT access token
 * @returns A Blob containing the PDF binary data
 */
export async function streamDownload(path: string, token: string): Promise<Blob> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  return response.blob();
}

/** Re-export AxiosError so callers don't need to import from axios directly. */
export { AxiosError };
