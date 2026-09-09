import { type FormEvent, useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { apiErrorMessage, toApiError } from "../api/errors";
import { Spinner } from "../components/shared/Spinner";
import { StatusBadge } from "../components/shared/StatusBadge";
import { ValidatedField } from "../components/shared/ValidatedField";
import { useSessionStore } from "../stores/sessionStore";
import type { CreateCredentialDto, ServiceCredentialDto } from "../types";

/**
 * CredentialsPage — /credentials
 *
 * Gestisce la credenziale di servizio dell'utente. Nell'MVP il backend ne
 * accetta una sola (`SUPPORTED_PROVIDERS = ['GITHUB']`): la chiave del modello
 * NON è una credenziale utente, è configurazione del servizio agenti
 * (LLM_API_KEY / IAM Task Role), quindi non si chiede qui.
 *
 * Contratto reale usato da questa pagina:
 *  - GET    /credentials              → ServiceCredentialDto[]
 *  - POST   /credentials {provider, token} → 201 ServiceCredentialDto.
 *    Il backend verifica il token vivo contro GitHub *prima* di salvarlo
 *    (RF.13–RF.14): non serve una seconda chiamata di validazione, un token
 *    rifiutato torna 400 con code CREDENTIAL_INVALID e non viene persistito.
 *  - POST   /credentials/:id/validate → ri-verifica una credenziale già salvata
 *  - DELETE /credentials/:id          → revoca locale
 *
 * I segreti non restano mai nel browser dopo l'invio: il campo viene svuotato
 * e nello store si tiene solo lo stato ('CONNECTED' | 'INVALID' | 'MISSING').
 */
const GITHUB_PROVIDER = "GITHUB";

export function CredentialsPage() {
  const set_status = useSessionStore((s) => s.setCredentialsStatus);
  const credentials_status = useSessionStore((s) => s.credentialsStatus);

  const [github_pat, setGithubPat] = useState("");
  const [errors, setErrors] = useState<{ github_pat?: string; global?: string }>({});
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [fetch_loading, setFetchLoading] = useState(true);

  const [github_credential, setGithubCredential] = useState<ServiceCredentialDto | null>(null);

  useEffect(() => {
    /** GET /credentials → array nudo di ServiceCredentialDto. */
    async function load_credential(): Promise<ServiceCredentialDto | null> {
      const response = await apiClient.get<ServiceCredentialDto[]>("/credentials");
      return response.data.find((c) => c.provider === GITHUB_PROVIDER) ?? null;
    }

    async function fetch_status() {
      try {
        const github = await load_credential();
        setGithubCredential(github);
        set_status(github ? "CONNECTED" : "MISSING");
      } catch {
        // Una GET fallita non dice che la credenziale manca, solo che non
        // siamo riusciti a leggerla: non si declassa lo stato a MISSING, che
        // farebbe scattare i guard di rotta su un'informazione non verificata.
        set_status("UNKNOWN");
      } finally {
        setFetchLoading(false);
      }
    }
    fetch_status();
  }, [set_status]);

  /**
   * Validazione client minima: il formato dei PAT GitHub è cambiato nel tempo
   * (classici a 40 hex, `ghp_`, fine-grained `github_pat_`), quindi si
   * controlla solo che il campo non sia vuoto — esattamente come fa il DTO
   * lato backend. Se il token funziona davvero lo dice GitHub, non un regex.
   */
  function validate(): boolean {
    const next: typeof errors = {};
    if (!github_pat.trim()) {
      next.github_pat = "Inserisci il GitHub Personal Access Token";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handle_submit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    setErrors({});
    setSuccess("");

    const dto: CreateCredentialDto = {
      provider: GITHUB_PROVIDER,
      token: github_pat.trim(),
    };

    try {
      const response = await apiClient.post<ServiceCredentialDto>("/credentials", dto);
      setGithubCredential(response.data);
      set_status("CONNECTED");
      setGithubPat("");
      setSuccess("Credenziale salvata e verificata. Puoi procedere a scegliere un repository.");
    } catch (err: unknown) {
      const { code } = toApiError(err);
      if (code === "CREDENTIAL_INVALID") {
        set_status("INVALID");
        setErrors({
          global: apiErrorMessage(err, "GitHub ha rifiutato questo token."),
        });
      } else {
        setErrors({
          global: apiErrorMessage(err, "Errore durante il salvataggio. Riprova più tardi."),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  /** "Verifica di nuovo" — POST /credentials/:id/validate (§4.2). */
  async function handle_revalidate() {
    if (!github_credential) return;
    setRevalidating(true);
    setErrors({});
    setSuccess("");
    try {
      const response = await apiClient.post<ServiceCredentialDto>(
        `/credentials/${github_credential.id}/validate`,
      );
      setGithubCredential(response.data);
      set_status("CONNECTED");
      setSuccess("La credenziale è ancora valida.");
    } catch (err: unknown) {
      set_status("INVALID");
      setErrors({
        global: apiErrorMessage(err, "La credenziale non è più valida: inseriscine una nuova."),
      });
    } finally {
      setRevalidating(false);
    }
  }

  /**
   * Revoca locale: rimuove il token cifrato dal nostro database, non lo revoca
   * su GitHub — quella resta un'azione dell'utente sul proprio account (§4.1).
   */
  async function handle_remove() {
    if (!github_credential) return;
    setRemoving(true);
    setErrors({});
    setSuccess("");
    try {
      await apiClient.delete(`/credentials/${github_credential.id}`);
      setGithubCredential(null);
      set_status("MISSING");
      setSuccess("Credenziale rimossa da Code Guardian. Su GitHub resta attiva: revocala da lì.");
    } catch (err: unknown) {
      setErrors({ global: apiErrorMessage(err, "Impossibile rimuovere la credenziale.") });
    } finally {
      setRemoving(false);
    }
  }

  function format_date(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("it-IT", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  const busy = saving || revalidating || removing;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-lg font-semibold text-[#2a2a2a]">Credenziali</h1>
      <p className="mb-6 text-sm text-gray-400">
        Il token viene cifrato e salvato sul server. Non viene mai restituito al browser dopo il
        salvataggio.
      </p>

      {/* Stato corrente */}
      {!fetch_loading && (
        <div className="mb-6 rounded-lg border border-[#cccccc] bg-gray-50 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Stato credenziali
          </p>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm text-gray-500">GitHub PAT:</span>
            {credentials_status === "CONNECTED" && <StatusBadge status="COMPLETED" />}
            {credentials_status === "INVALID" && <StatusBadge status="FAILED" />}
            {(credentials_status === "MISSING" || credentials_status === "UNKNOWN") && (
              <StatusBadge status="PENDING" />
            )}
            <span className="text-xs text-gray-400">
              {credentials_status === "CONNECTED" && "Connessa e valida"}
              {credentials_status === "INVALID" && "Non valida – aggiornala"}
              {credentials_status === "MISSING" && "Non configurata"}
              {credentials_status === "UNKNOWN" && "Stato non verificabile"}
            </span>
          </div>

          {github_credential && (
            <>
              <p className="text-xs text-gray-400">
                Ultima validazione: {format_date(github_credential.connectedAt)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handle_revalidate}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded border border-[#cccccc] px-3 py-1.5 text-xs text-[#2a2a2a] transition hover:bg-white disabled:opacity-50"
                >
                  {revalidating && <Spinner size="sm" />}
                  Verifica di nuovo
                </button>
                <button
                  type="button"
                  onClick={handle_remove}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded border border-[#cc2222] px-3 py-1.5 text-xs text-[#cc2222] transition hover:bg-red-50 disabled:opacity-50"
                >
                  {removing && <Spinner size="sm" className="text-[#cc2222]" />}
                  Disconnetti
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {errors.global && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#cc2222]">
          {errors.global}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-[#2a8a2a]">
          {success}
        </div>
      )}

      <form onSubmit={handle_submit} noValidate className="flex flex-col gap-5">
        <div>
          <ValidatedField
            label={
              github_credential
                ? "Sostituisci il GitHub Personal Access Token"
                : "GitHub Personal Access Token"
            }
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
            Serve lo scope <code className="font-mono">repo</code> (un token fine-grained va bene se
            dà accesso ai repository da analizzare). Generane uno su{" "}
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

        <button
          type="submit"
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded bg-[#2a2a2a] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#111] disabled:opacity-60"
        >
          {saving && <Spinner size="sm" className="text-white" />}
          {saving ? "Verifica in corso…" : "Salva e verifica"}
        </button>
      </form>
    </div>
  );
}
