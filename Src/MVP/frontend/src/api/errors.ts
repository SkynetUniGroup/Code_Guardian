import { AxiosError } from "axios";

/**
 * Normalised form of an error coming from the API.
 *
 * The backend always responds with the same envelope (AllExceptionsFilter):
 * `{ code, message, details? }`. The pages each read it in their own way,
 * with `catch (err: any)` and hand-written optional chaining chains: besides
 * being noise, it means each point can get the field name to read wrong
 * independently of the others.
 */
export interface ApiError {
  /** HTTP status code, absent if the request never reached its destination. */
  status?: number;
  /** Application code from the BE-2 catalogue (e.g. USAGE_LIMIT_EXCEEDED). */
  code?: string;
  /** Backend message, when present. */
  message?: string;
  /** Validation details, present only on VALIDATION_ERROR. */
  details?: string[];
}

interface BackendErrorBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

/** Normalises any exception into an ApiError, without ever throwing itself. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof AxiosError) {
    const body = (err.response?.data ?? {}) as BackendErrorBody;
    return {
      status: err.response?.status,
      code: typeof body.code === "string" ? body.code : undefined,
      message: typeof body.message === "string" ? body.message : err.message,
      details: Array.isArray(body.details) ? (body.details as string[]) : undefined,
    };
  }
  return { message: err instanceof Error ? err.message : undefined };
}

/** Backend message if present, otherwise the fallback provided by the caller. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  return toApiError(err).message ?? fallback;
}
