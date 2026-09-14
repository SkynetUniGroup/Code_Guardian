import { type FormEvent, useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { apiErrorMessage, toApiError } from "../api/errors";
import { Spinner } from "../components/shared/Spinner";
import { StatusBadge } from "../components/shared/StatusBadge";
import { ValidatedField } from "../components/shared/ValidatedField";
import { useSessionStore } from "../stores/sessionStore";
import type { CreateCredentialDto, ServiceCredentialDto } from "../types";

/**
 * CredentialsPage â /credentials
 *
 * Manages the user's service credentials.
 *
 *  - **GitHub PAT** (`provider: "GITHUB"`): required. Without it, /select and /run
 *    are unreachable â the guard is on the route's `beforeLoad` and the
 *    state lives in `sessionStore.credentialsStatus`.
 *  - **SonarQube** (`provider: "SONARQUBE"`): optional. If present, DOCS_*
 *    operations enrich the prompt with the project's quality metrics; if
 *    absent or unreachable, the operation still runs. It does not affect
 *    route guards and does not enter the store.
 *
 * The LLM model key is NOT a user credential: it is configuration of the
 * agent service (LLM_API_KEY / IAM Task Role), so it is not requested here.
 *
 * Contract:
 *  - GET    /credentials                â ServiceCredentialDto[]
 *  - POST   /credentials {provider, ...} â 201 ServiceCredentialDto.
 *    The backend verifies the credential live against the provider *before*
 *    saving it (RF.13âRF.14): a rejected token returns 400 CREDENTIAL_INVALID
 *    and is not persisted.
 *  - POST   /credentials/:id/validate   â re-validates a saved credential
 *  - DELETE /credentials/:id            â local revocation
 *
 * Secrets never remain in the browser after submission: the fields are cleared.
 */
const GITHUB_PROVIDER = "GITHUB";
const SONARQUBE_PROVIDER = "SONARQUBE";

export function CredentialsPage() {
  const role = useSessionStore((s) => s.user?.role);
  const set_status = useSessionStore((s) => s.setCredentialsSt
atus);
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
    /** GET /credentials â raw array of ServiceCredentialDto. */
    async function fetch_status() {
      try {
        const response = await apiClient.get<ServiceCredentialDto[]>("/credentials");
        const github = response.data.find((c) => c.provider === GITHUB_PROVIDER) ?? null;
        setGithubCredential(github);
        setSonarCredential(response.data.find((c) => c.provider === SONARQUBE_PROVIDER) ?? null);
        set_status(github ? "CONNECTED" : "MISSING");
      } catch {
        // A failed GET does not mean the credential is missing, only that we
        // could not read it: the status is not downgraded to MISSING, which
        // would trigger route guards on unverified information.
        set_status("UNKNOWN");
      } finally {
        setFetchLoading(false);
      }
    }
    fetch_status();
  }, [set_status]);

  /**
   * Minimal client-side validation: the GitHub PAT format has changed over time
   * (classic 40-char hex, `ghp_`, fine-grained `github_pat_`), so we only
   * check that the field is not empty â exactly as the backend DTO does.
   * Whether the token actually works is told by GitHub, not a regex.
   */
  function validate(): boolean {
    const next: typeof errors = {};
    if (!github_pat.trim()) {
      next.github_pat = "Enter your GitHub Per
sonal Access Token";
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
      setSuccess("Credential saved and verified. You can proceed to select a repository.");
    } catch (err: unknown) {
      const { code } = toApiError(err);
      if (code === "CREDENTIAL_INVALID") {
        set_status("INVALID");
        setErrors({
          global: apiErrorMessage(err, "GitHub rejected this token."),
        });
      } else {
        setErrors({
          global: apiErrorMessage(err, "Error during save. Try again later."),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  /** "Verify again" â POST /credentials/:id/validate (Â§4.2). */
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
      setSuccess("The credential is still valid.");
    } catch (err: unknown) {
      set_status("INVALID");
      setErrors({
        global: apiErrorMessage(err, "The credential is no longer valid: enter a new one."),
      });
    } finally {
      setRevalidating(false);
    }
  }

  /**
   * Local revocation: removes the encrypted token from our database, does not
   * revoke it on GitHub â that remains a user action on their account (Â§4.1).
   */
  async function handle_remove()
 {
    if (!github_credential) return;
    setRemoving(true);
    setErrors({});
    setSuccess("");
    try {
      await apiClient.delete(`/credentials/${github_credential.id}`);
      setGithubCredential(null);
      set_status("MISSING");
      setSuccess("Credential removed from Code Guardian. It remains active on GitHub: revoke it there.");
    } catch (err: unknown) {
      setErrors({ global: apiErrorMessage(err, "Unable to remove the credential.") });
    } finally {
      setRemoving(false);
    }
  }

  function format_date(iso: string | null): string {
    if (!iso) return "â";
    return new Date(iso).toLocaleString("en-US", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  const busy = saving || revalidating || removing;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-lg font-semibold text-[#2a2a2a]">Credentials</h1>
      <p className="mb-6 text-sm text-gray-400">
        Tokens are encrypted and stored on the server. They are never returned to the browser after
        saving.
      </p>

      {/* Current status */}
      {!fetch_loading && (
        <div className="mb-6 rounded-lg border border-[#cccccc] bg-gray-50 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Credential status
          </p>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm text-gray-500">GitHub PAT:</span>
            {credentials_status === "CONNECTED" && <StatusBadge status="COMPLETED" />}
            {credentials_status === "INVALID" && <StatusBadge status="FAILED" />}
            {(credentials_status === "MISSING" || credentials_status === "UNKNOWN") && (
              <StatusBadge status="PENDING" />
            )}
            <span className="text-xs text-gray-400">
              {credentials_status === "CONNECTED" && "Connected and valid"}
              {credentials_status === "INVALID" && "Invalid â update i
t"}
              {credentials_status === "MISSING" && "Not configured"}
              {credentials_status === "UNKNOWN" && "Status unverifiable"}
            </span>
          </div>

          {github_credential && (
            <>
              <p className="text-xs text-gray-400">
                Last validation: {format_date(github_credential.connectedAt)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handle_revalidate}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded border border-[#cccccc] px-3 py-1.5 text-xs text-[#2a2a2a] transition hover:bg-white disabled:opacity-50"
                >
                  {revalidating && <Spinner size="sm" />}
                  Verify again
                </button>
                <button
                  type="button"
                  onClick={handle_remove}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded border border-[#cc2222] px-3 py-1.5 text-xs text-[#cc2222] transition hover:bg-red-50 disabled:opacity-50"
                >
                  {removing && <Spinner size="sm" className="text-[#cc2222]" />}
                  Disconnect
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
                ? "Replace GitHub Personal Access Token"
      
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
            Requires the <code className="font-mono">repo</code> scope (a fine-grained token is fine if it
            grants access to the repositories to analyze). Generate one at{" "}
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
          {saving ? "Verifyingâ¦" : "Save and verify"}
        </button>
      </form>

      {!fetch_loading && role === "DEVELOPER" && (
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
 * SonarQube card â optional provider.
 *
 * Holds its own local state and does not touch `sessionStore`: a missing or
 * invalid SonarQube credential must never block a route. The status text is
 * intentionally different from GitHub's ("Project linked" vs
 * "Connected and valid") so e2e specs can distinguish the two cards.
 */
function SonarqubeCredentialCard({
  credential,
  onChange,
  formatDate,
}: {
  credential: 
ServiceCredentialDto | null;
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
    if (!instanceUrl.trim()) next.instanceUrl = "Enter the instance URL";
    if (!projectKey.trim()) next.projectKey = "Enter the project key";
    if (!token.trim()) next.token = "Enter the SonarQube token";
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
      setNotice("SonarQube project linked. DOCS operations will use its metrics.");
    } catch (err: unknown) {
      const { code } = toApiError(err);
      setGlobalError(
        apiErrorMessage(
          err,
          code === "CREDENTIAL_INVALID"
            ? "SonarQube rejected these 
credentials."
            : "Error during save. Try again later.",
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
      setNotice("SonarQube credentials are still valid.");
    } catch (err: unknown) {
      setGlobalError(
        apiErrorMessage(err, "SonarQube credentials are no longer valid: update them."),
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
      setNotice("SonarQube project unlinked. DOCS operations continue without metrics.");
    } catch (err: unknown) {
      setGlobalError(apiErrorMessage(err, "Unable to unlink the project."));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="mt-10 border-t border-[#e5e5e5] pt-8">
      <h2 className="mb-1 text-base font-semibold text-[#2a2a2a]">SonarQube / SonarCloud</h2>
      <p className="mb-4 text-sm text-gray-400">
        Optional. Link a project to bring its quality metrics (complexity, code
        smell, hotspot) into the documentation operation prompts. If you don't link one, or if
        the instance is unreachable, operations still run.
      </p>

      <div className="mb-4 rounded-lg border border-[#cccccc] bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Project:</span>
          <StatusBadge status={credential ? "COMPLETED" : "PENDING"} />
          <span className="text-xs text-gray-400">
            {credential ? "Projec
t linked" : "No SonarQube project"}
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
                Verify again
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
          label="SonarQube instance URL"
          type="url"
          autoComplete="off"
          placeholder="https://sonarcloud.io"
          value={instanceUrl}
          onChange={(e) => {
            setInstanceUrl(e.target.value);
            setFieldErrors((p) => ({ ...p, instanceUrl: "" }));
          }}
          erro
r={fieldErrors.instanceUrl}
        />
        <ValidatedField
          label="Project key"
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
          label="Organization (SonarCloud only)"
          type="text"
          autoComplete="off"
          placeholder="mia-org"
          value={organizationKey}
          onChange={(e) => setOrganizationKey(e.target.value)}
        />
        <div>
          <ValidatedField
            label={credential ? "Replace SonarQube token" : "SonarQube token"}
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
            A user token with read access to the project. The "Browse" permission is sufficient.
          </p>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded bg-[#2a2a2a] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#111] disabled:opacity-60"
        >
          {saving && <Spinner size="sm" className="text-white" />}
          {saving ? "Verifying…" : "Link project"}
        </button>
      </form>
    </section>
  );
}
