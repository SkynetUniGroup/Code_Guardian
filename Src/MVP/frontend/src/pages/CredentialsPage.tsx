import { useState, useEffect, type FormEvent } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { apiClient } from '../api/client';
import { ValidatedField } from '../components/shared/ValidatedField';
import { Spinner } from '../components/shared/Spinner';
import { StatusBadge } from '../components/shared/StatusBadge';
import type { ServiceCredentialDto } from '../types';

/**
 * CredentialsPage — /credentials
 *
 * Allows the user to save or update their service credentials:
 *  - GitHub Personal Access Token (PAT)
 *  - OpenAI API Key
 *
 * On load, fetches the current credentials list from GET /credentials
 * (returns ServiceCredentialDto[]) and derives the overall status shown
 * in sessionStore.
 *
 * On form submit, calls POST /credentials followed by POST /credentials/validate
 * to verify them against the external services before persisting.
 *
 * The actual secret values are NEVER stored on the frontend; only the status
 * ('connected' | 'invalid' | 'missing') is tracked in the sessionStore.
 */
export function CredentialsPage() {
  const set_status = useSessionStore((s) => s.setCredentialsStatus);
  const credentials_status = useSessionStore((s) => s.credentialsStatus);

  // Form state (secrets shown only while editing; never persisted locally)
  const [github_pat, setGithubPat] = useState('');
  const [openai_key, setOpenaiKey] = useState('');
  const [errors, setErrors] = useState<{ github_pat?: string; openai_key?: string; global?: string }>({});
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [fetch_loading, setFetchLoading] = useState(true);

  /**
   * Stores the GitHub credential record returned by the backend, used to
   * show lastValidatedAt and provider status information.
   */
  const [github_credential, setGithubCredential] = useState<ServiceCredentialDto | null>(null);

  // On mount: fetch current credentials list from GET /credentials.
  useEffect(() => {
    async function fetch_status() {
      try {
        const response = await apiClient.get<ServiceCredentialDto[]>('/credentials');
        const credentials = response.data;

        // Find the GitHub credential from the list.
        const github = credentials.find((c) => c.provider === 'GITHUB') ?? null;
        setGithubCredential(github);

        if (!github) {
          set_status('missing');
        } else if (github.status === 'CONNECTED') {
          set_status('connected');
        } else {
          set_status('invalid');
        }
      } catch {
        // If the request fails, assume credentials are missing.
        set_status('missing');
      } finally {
        setFetchLoading(false);
      }
    }
    fetch_status();
  }, [set_status]);

  /** Client-side validation before the API call. */
  function validate(): boolean {
    const next: typeof errors = {};
    if (!github_pat.trim()) {
      next.github_pat = 'Inserisci il GitHub PAT';
    } else if (!github_pat.trim().startsWith('ghp_') && !github_pat.trim().startsWith('github_pat_')) {
      next.github_pat = 'Il PAT GitHub deve iniziare con ghp_ oppure github_pat_';
    }
    if (!openai_key.trim()) {
      next.openai_key = 'Inserisci la chiave API OpenAI';
    } else if (!openai_key.trim().startsWith('sk-')) {
      next.openai_key = 'La chiave OpenAI deve iniziare con sk-';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handle_submit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setErrors({});

    try {
      // 1. Save the credentials.
      await apiClient.post('/credentials', {
        githubPat: github_pat.trim(),
        openaiApiKey: openai_key.trim(),
      });

      // 2. Validate them against the external services.
      setValidating(true);
      const validation = await apiClient.post<{ valid: boolean; message?: string }>(
        '/credentials/validate',
      );

      if (validation.data.valid) {
        set_status('connected');
        // Clear the fields after successful save (the secrets are no longer needed).
        setGithubPat('');
        setOpenaiKey('');
        // Re-fetch to update the displayed lastValidatedAt timestamp.
        const refreshed = await apiClient.get<ServiceCredentialDto[]>('/credentials');
        const github = refreshed.data.find((c) => c.provider === 'GITHUB') ?? null;
        setGithubCredential(github);
      } else {
        set_status('invalid');
        setErrors({ global: validation.data.message ?? 'Le credenziali non sono valide.' });
      }
    } catch {
      setErrors({ global: 'Errore durante il salvataggio. Riprova più tardi.' });
    } finally {
      setLoading(false);
      setValidating(false);
    }
  }

  /**
   * Formats an ISO-8601 string as a localised date+time.
   * Returns a dash when the value is null (credential never validated).
   */
  function format_date(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('it-IT', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  }

  const is_saving = loading || validating;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-lg font-semibold text-[#2a2a2a]">Credenziali</h1>
      <p className="mb-6 text-sm text-gray-400">
        Le credenziali vengono cifrate e salvate in modo sicuro sul server. Non vengono mai
        esposte nel browser dopo il salvataggio.
      </p>

      {/* Current status indicator */}
      {!fetch_loading && (
        <div className="mb-6 rounded-lg border border-[#cccccc] bg-gray-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Stato credenziali
          </p>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-gray-500">GitHub PAT:</span>
            {credentials_status === 'connected' && <StatusBadge status="COMPLETED" />}
            {credentials_status === 'invalid' && <StatusBadge status="FAILED" />}
            {(credentials_status === 'missing' || credentials_status === 'unknown') && (
              <StatusBadge status="PENDING" />
            )}
            <span className="text-xs text-gray-400">
              {credentials_status === 'connected' && 'Connessa e valida'}
              {credentials_status === 'invalid' && 'Non valida – aggiorna'}
              {credentials_status === 'missing' && 'Non configurata'}
              {credentials_status === 'unknown' && 'Verifica in corso…'}
            </span>
          </div>
          {github_credential && (
            <p className="text-xs text-gray-400">
              Ultima validazione: {format_date(github_credential.lastValidatedAt)}
            </p>
          )}
        </div>
      )}

      {/* Global error */}
      {errors.global && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#cc2222]">
          {errors.global}
        </div>
      )}

      {/* Success banner */}
      {credentials_status === 'connected' && !loading && (
        <div className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-[#2a8a2a]">
          Credenziali salvate e validate con successo. Puoi procedere a scegliere un repository.
        </div>
      )}

      <form onSubmit={handle_submit} noValidate className="flex flex-col gap-5">
        {/* GitHub PAT */}
        <div>
          <ValidatedField
            label="GitHub Personal Access Token"
            type="password"
            autoComplete="off"
            placeholder="ghp_xxxxxxxxxxxx"
            value={github_pat}
            onChange={(e) => {
              setGithubPat(e.target.value);
              setErrors((p) => ({ ...p, github_pat: undefined }));
            }}
            error={errors.github_pat}
          />
          <p className="mt-1 text-xs text-gray-400">
            Richiede permessi: repo, read:org, read:user. Genera un token su{' '}
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noreferrer"
              className="text-[#2277cc] hover:underline"
            >
              github.com/settings/tokens
            </a>
          </p>
        </div>

        {/* OpenAI API Key */}
        <div>
          <ValidatedField
            label="OpenAI API Key"
            type="password"
            autoComplete="off"
            placeholder="sk-xxxxxxxxxxxx"
            value={openai_key}
            onChange={(e) => {
              setOpenaiKey(e.target.value);
              setErrors((p) => ({ ...p, openai_key: undefined }));
            }}
            error={errors.openai_key}
          />
          <p className="mt-1 text-xs text-gray-400">
            Reperibile su{' '}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="text-[#2277cc] hover:underline"
            >
              platform.openai.com/api-keys
            </a>
          </p>
        </div>

        <button
          type="submit"
          disabled={is_saving}
          className="flex items-center justify-center gap-2 rounded bg-[#2a2a2a] px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-200 transition disabled:opacity-60"
        >
          {is_saving && <Spinner size="sm" className="text-white" />}
          {validating ? 'Verifica in corso…' : 'Salva e verifica'}
        </button>
      </form>
    </div>
  );
}
