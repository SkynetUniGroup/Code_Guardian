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
 * Gestisce le credenziali di servizio dell'utente.
 *
 *  - **GitHub PAT** (`provider: "GITHUB"`): obbligatorio. Senza, /select e /run
 *    non sono raggiungibili — il guard sta su `beforeLoad` della rotta e lo
 *    stato vive in `sessionStore.credentialsStatus`.
 *  - **SonarQube** (`provider: "SONARQUBE"`): opzionale. Se presente, le
 *    operazioni DOCS_* arricchiscono il prompt con le metriche di qualità del
 *    progetto; se assente o irraggiungibile, l'operazione gira comunque. Non
 *    tocca i guard di rotta e non entra nello store.
 *
 * La chiave del modello LLM NON è una credenziale utente: è configurazione del
 * servizio agenti (LLM_API_KEY / IAM Task Role), quindi non si chiede qui.
 *
 * Contratto:
 *  - GET    /credentials                → ServiceCredentialDto[]
 *  - POST   /credentials {provider, ...} → 201 ServiceCredentialDto.
 *    Il backend verifica la credenziale viva contro il provider *prima* di
 *    salvarla (RF.13–RF.14): un token rifiutato torna 400 CREDENTIAL_INVALID e
 *    non viene persistito.
 *  - POST   /credentials/:id/validate   → ri-verifica una credenziale salvata
 *  - DELETE /credentials/:id            → revoca locale
 *
 * I segreti non restano mai nel browser dopo l'invio: i campi vengono svuotati.
 */
const GITHUB_PROVIDER = "GITHUB";
const SONARQUBE_PROVIDER = "SONARQUBE";

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
  const [sonar_credential, setSonarCredential] = useState<ServiceCredentialDto | null>(null);

  useEffect(() => {
    /** GET /credentials → array nudo di ServiceCredentialDto. */
    async function fetch_status() {
      try {
        const response = await apiClient.get<ServiceCredentialDto[]>("/credentials");
        const github = response.data.find((c) => c.provider === GITHUB_PROVIDER) ?? null;
        setGithubCredential(github);
        setSonarCredential(response.data.find((c) => c.provider === SONARQUBE_PROVIDER) ?? null);
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
        I token vengono cifrati e salvati sul server. Non vengono mai restituiti al browser dopo il
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

      {!fetch_loading && (
        <SonarqubeCredentialCard
          credential={sonar_credential}
          onChange={setSonarCredential}
          formatDate={format_date}
        />
      )}
    </div>
  );
}

/**
 * Riquadro SonarQube — provider opzionale.
 *
 * Tiene il proprio stato locale e non tocca `sessionStore`: una credenziale
 * SonarQube mancante o non valida non deve mai bloccare una rotta. Il testo di
 * stato è volutamente diverso da quello di GitHub ("Progetto collegato" vs
 * "Connessa e valida") così gli spec e2e possono distinguere i due riquadri.
 */
function SonarqubeCredentialCard({
  credential,
  onChange,
  formatDate,
}: {
  credential: ServiceCredentialDto | null;
  onChange: (next: ServiceCredentialDto | null) => void;
  formatDate: (iso: string | null) => string;
}) {
  const [instanceUrl, setInstanceUrl] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [organizationKey, setOrganizationKey] = useState("");
  const [token, setToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [removing, setRemoving] = useState(false);

  const busy = saving || revalidating || removing;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!instanceUrl.trim()) next.instanceUrl = "Inserisci l'URL dell'istanza";
    if (!projectKey.trim()) next.projectKey = "Inserisci la chiave del progetto";
    if (!token.trim()) next.token = "Inserisci il token SonarQube";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    setFieldErrors({});
    setGlobalError("");
    setNotice("");

    const dto: CreateCredentialDto = {
      provider: SONARQUBE_PROVIDER,
      token: token.trim(),
      instanceUrl: instanceUrl.trim(),
      projectKey: projectKey.trim(),
      ...(organizationKey.trim() ? { organizationKey: organizationKey.trim() } : {}),
    };

    try {
      const response = await apiClient.post<ServiceCredentialDto>("/credentials", dto);
      onChange(response.data);
      setToken("");
      setNotice("Progetto SonarQube collegato. Le operazioni DOCS useranno le sue metriche.");
    } catch (err: unknown) {
      const { code } = toApiError(err);
      setGlobalError(
        apiErrorMessage(
          err,
          code === "CREDENTIAL_INVALID"
            ? "SonarQube ha rifiutato queste credenziali."
            : "Errore durante il salvataggio. Riprova più tardi.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRevalidate() {
    if (!credential) return;
    setRevalidating(true);
    setGlobalError("");
    setNotice("");
    try {
      const response = await apiClient.post<ServiceCredentialDto>(
        `/credentials/${credential.id}/validate`,
      );
      onChange(response.data);
      setNotice("Le credenziali SonarQube sono ancora valide.");
    } catch (err: unknown) {
      setGlobalError(
        apiErrorMessage(err, "Le credenziali SonarQube non sono più valide: aggiornale."),
      );
    } finally {
      setRevalidating(false);
    }
  }

  async function handleRemove() {
    if (!credential) return;
    setRemoving(true);
    setGlobalError("");
    setNotice("");
    try {
      await apiClient.delete(`/credentials/${credential.id}`);
      onChange(null);
      setNotice("Progetto SonarQube scollegato. Le operazioni DOCS proseguono senza metriche.");
    } catch (err: unknown) {
      setGlobalError(apiErrorMessage(err, "Impossibile scollegare il progetto."));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="mt-10 border-t border-[#e5e5e5] pt-8">
      <h2 className="mb-1 text-base font-semibold text-[#2a2a2a]">SonarQube / SonarCloud</h2>
      <p className="mb-4 text-sm text-gray-400">
        Opzionale. Collega un progetto per far entrare le sue metriche di qualità (complessità, code
        smell, hotspot) nei prompt delle operazioni di documentazione. Se non lo colleghi, o se
        l'istanza è irraggiungibile, le operazioni girano comunque.
      </p>

      <div className="mb-4 rounded-lg border border-[#cccccc] bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Progetto:</span>
          <StatusBadge status={credential ? "COMPLETED" : "PENDING"} />
          <span className="text-xs text-gray-400">
            {credential ? "Progetto collegato" : "Nessun progetto SonarQube"}
          </span>
        </div>
        {credential && (
          <>
            <p className="mt-1 text-xs text-gray-400">
              Ultima validazione: {formatDate(credential.connectedAt)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleRevalidate}
                disabled={busy}
                className="flex items-center gap-1.5 rounded border border-[#cccccc] px-3 py-1.5 text-xs text-[#2a2a2a] transition hover:bg-white disabled:opacity-50"
              >
                {revalidating && <Spinner size="sm" />}
                Verifica di nuovo
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="flex items-center gap-1.5 rounded border border-[#cc2222] px-3 py-1.5 text-xs text-[#cc2222] transition hover:bg-red-50 disabled:opacity-50"
              >
                {removing && <Spinner size="sm" className="text-[#cc2222]" />}
                Scollega
              </button>
            </div>
          </>
        )}
      </div>

      {globalError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#cc2222]">
          {globalError}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-[#2a8a2a]">
          {notice}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <ValidatedField
          label="URL istanza SonarQube"
          type="url"
          autoComplete="off"
          placeholder="https://sonarcloud.io"
          value={instanceUrl}
          onChange={(e) => {
            setInstanceUrl(e.target.value);
            setFieldErrors((p) => ({ ...p, instanceUrl: "" }));
          }}
          error={fieldErrors.instanceUrl}
        />
        <ValidatedField
          label="Chiave progetto"
          type="text"
          autoComplete="off"
          placeholder="mia-org_mio-progetto"
          value={projectKey}
          onChange={(e) => {
            setProjectKey(e.target.value);
            setFieldErrors((p) => ({ ...p, projectKey: "" }));
          }}
          error={fieldErrors.projectKey}
        />
        <ValidatedField
          label="Organizzazione (solo SonarCloud)"
          type="text"
          autoComplete="off"
          placeholder="mia-org"
          value={organizationKey}
          onChange={(e) => setOrganizationKey(e.target.value)}
        />
        <div>
          <ValidatedField
            label={credential ? "Sostituisci il token SonarQube" : "Token SonarQube"}
            type="password"
            autoComplete="off"
            placeholder="squ_xxxxxxxxxxxx"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setFieldErrors((p) => ({ ...p, token: "" }));
            }}
            error={fieldErrors.token}
          />
          <p className="mt-1 text-xs text-gray-400">
            Un token utente con accesso in lettura al progetto. Basta il permesso «Browse».
          </p>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded bg-[#2a2a2a] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#111] disabled:opacity-60"
        >
          {saving && <Spinner size="sm" className="text-white" />}
          {saving ? "Verifica in corso…" : "Collega progetto"}
        </button>
      </form>
    </section>
  );
}
