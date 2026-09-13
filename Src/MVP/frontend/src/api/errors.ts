import { AxiosError } from "axios";

/**
 * Forma normalizzata di un errore proveniente dall'API.
 *
 * Il backend risponde sempre con lo stesso envelope (AllExceptionsFilter):
 * `{ code, message, details? }`. Le pagine però lo leggevano ognuna a modo
 * proprio, con `catch (err: any)` e catene di optional chaining ripetute a
 * mano: oltre a essere rumore, significa che ogni punto può sbagliare
 * indipendentemente dagli altri il nome del campo da leggere.
 */
export interface ApiError {
  /** Codice HTTP, assente se la richiesta non è mai arrivata a destinazione. */
  status?: number;
  /** Codice applicativo del catalogo di BE-2 (es. USAGE_LIMIT_EXCEEDED). */
  code?: string;
  /** Messaggio del backend, quando c'è. */
  message?: string;
  /** Dettagli di validazione, presenti solo su VALIDATION_ERROR. */
  details?: string[];
}

interface BackendErrorBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

/** Normalizza qualsiasi eccezione in un ApiError, senza mai lanciare a sua volta. */
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

/** Messaggio del backend se c'è, altrimenti il fallback fornito dal chiamante. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  return toApiError(err).message ?? fallback;
}
