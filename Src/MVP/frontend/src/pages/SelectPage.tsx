import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { apiErrorMessage, toApiError } from "../api/errors";
import { ErrorState } from "../components/shared/ErrorState";
import { Spinner } from "../components/shared/Spinner";
import { ValidatedField } from "../components/shared/ValidatedField";
import { useSelectionStore } from "../stores/selectionStore";
import type { AnalysisContextDto, CreateContextDto, RepositorySummary } from "../types";


const GITHUB_REPO_URL_REGEX = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/;

function fieldErrorFromApiError(err: unknown): Record<string, string> {
  const { code, message } = toApiError(err);
  if (!message) return {};

  if (code === "CONTEXT_RESOURCE_MISSING" && /branch/i.test(message)) {
    return { ref: message };
  }
  if (code === "CONTEXT_RESOURCE_MISSING" && /path/i.test(message)) {
    return { paths: message };
  }
  if (code === "CONTEXT_RESOURCE_INVALID" && /commit/i.test(message)) {
    return { commit_sha: message };
  }
  if (code === "CONTEXT_RESOURCE_INVALID" && /path/i.test(message)) {
    return { paths: message };
  }
  return {};
}

/**
 * SelectPage — /select
 *
 * Allows the user to choose a GitHub repository and configure the analysis
 * context (branch/ref, scope type, paths).
 *
 * Flow:
 *  1. Fetches the list of accessible repositories from GET /repositories.
 *  2. User selects a repo, branch, and scope type (FULL_REPOSITORY | FILES | DIRECTORIES).
 *  3. When scopeType is FILES or DIRECTORIES the user can enter specific paths.
 *  4. On submit, POSTs to POST /contexts; the returned AnalysisContextDto is
 *     stored in selectionStore so /run can consume it without a second API call.
 *  5. Redirects to /run.
 */
export function SelectPage() {
  const navigate = useNavigate();
  const setContext = useSelectionStore((s) => s.setContext);
  const setFormContext = useSelectionStore((s
) => s.setFormContext);
  const formContext = useSelectionStore((s) => s.formContext);

  // Repository list state
  const [repos, setRepos] = useState<RepositorySummary[]>([]);
  const [repos_loading, setReposLoading] = useState(true);
  const [repos_error, setReposError] = useState("");

  // Form state
  const [selected_repo, setSelectedRepo] = useState<RepositorySummary | null>(null);
  const [manual_repo_url, setManualRepoUrl] = useState("");
  const [ref, setRef] = useState("");
  const [commit_sha, setCommitSha] = useState("");
  const [scope_type, setScopeType] = useState<CreateContextDto["scopeType"]>("FULL_REPOSITORY");
  const [paths_text, setPathsText] = useState("");
  const [form_errors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submit_error, setSubmitError] = useState("");

  // Pre-fill form from formContext when it exists
  useEffect(() => {
    if (formContext) {
      setSelectedRepo(formContext.selected_repo);
      setManualRepoUrl(formContext.manual_repo_url);
      setRef(formContext.ref);
      setCommitSha(formContext.commit_sha);
      setScopeType(formContext.scope_type as CreateContextDto["scopeType"]);
      setPathsText(formContext.paths_text);
    }
  }, [formContext]);

  // Fetch repositories on mount.
  useEffect(() => {
    async function fetch_repos() {
      try {
        // GET /repositories returns a raw array (RepositorySummary[]),
        // not an object {repositories: [...]}: reading .repositories returned
        // undefined and the page always ended up in the error state.
        const response = await apiClient.get<RepositorySummary[]>("/repositories");
        setRepos(response.data);
      } catch {
        setReposError(
          "Unable to load repositories. Verify that the GitHub credentials are valid.",
        );
      } finally {
        setReposLoading(false);
      }
    }
    fetch_repos();
  }, []);

  // When the u
ser selects a repo, pre-fill the ref with its default branch.
  function handle_repo_change(owner_name: string) {
    const repo = repos.find((r) => `${r.owner}/${r.name}` === owner_name) ?? null;
    setSelectedRepo(repo);
    setManualRepoUrl("");
    setRef(repo?.defaultBranch ?? "");
  }

  function handle_manual_repo_url_change(value: string) {
    setManualRepoUrl(value);
    if (value.trim()) setSelectedRepo(null);
  }

  /** Client-side validation. */
  function validate(): boolean {
    const next: Record<string, string> = {};
    const manual_url = manual_repo_url.trim();
    if (!selected_repo && !manual_url) {
      next.repo = "Select a repository or paste the URL of a public repository";
    } else if (manual_url && !GITHUB_REPO_URL_REGEX.test(manual_url)) {
      next.repo_url = "Invalid URL (https://github.com/owner/repo)";
    }
    if (!ref.trim()) next.ref = "Enter the branch";
    if (commit_sha.trim() && !/^[0-9a-f]{7,40}$/i.test(commit_sha.trim())) {
      next.commit_sha = "Il commit SHA deve essere esadecimale (7-40 caratteri)";
    }
    if (scope_type !== "FULL_REPOSITORY" && !paths_text.trim()) {
      next.paths = "Enter at least one path";
    }
    setFormErrors(next);
    return Object.keys(next).length === 0;
  }
  

  async function handle_submit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setSubmitError("");

    // Convert newline-separated paths to an array, filtering blank lines.
    const paths_array = paths_text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const repo_url =
      manual_repo_url.trim() || `https://github.com/${selected_repo?.owner}/${selected_repo?.name}`;

    const dto: CreateContextDto = {
      repoUrl: repo_url,
      branch: ref.trim(),
      // If absent, the backend anchors the context to the branch HEAD (RF.17).
      // The field existed in the DTO but nobody filled it: pinning to a
      // comm
it specifico (RF.22) era irraggiungibile dall'interfaccia.
      ...(commit_sha.trim() ? { commitSha: commit_sha.trim() } : {}),
      scopeType: scope_type,
      ...(paths_array.length > 0 ? { paths: paths_array } : {}),
    };

    try {
      const response = await apiClient.post<AnalysisContextDto>("/contexts", dto);
      // Store the full context DTO so /run can read repo metadata without
      // an additional API round-trip.
      setContext(response.data);
      // Store form context for repopulating the form on return visits
      setFormContext({
        manual_repo_url,
        selected_repo,
        ref,
        commit_sha,
        scope_type,
        paths_text,
      });
      navigate({ to: "/run" });
    } catch (err) {
      const field_errors = fieldErrorFromApiError(err);
      if (Object.keys(field_errors).length > 0) {
        setFormErrors((p) => ({ ...p, ...field_errors }));
      } else {
        setSubmitError(
          apiErrorMessage(err, "Unable to save the context. Verify the parameters and try again."),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Render ----

  if (repos_loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <Spinner size="sm" />
        Loading repositories…
      </div>
    );
  }

  if (repos_error) {
    return (
      <ErrorState
        message={repos_error}
        action={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-[#cccccc] px-3 py-1.5 text-sm text-[#2a2a2a] hover:bg-gray-50"
          >
            Try again
          </button>
        }
      />
    );
  }

  /** Whether the current scope type requires explicit paths input. */
  const requires_paths = scope_type !== "FULL_REPOSITORY";

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-lg font-semibold text-[#2a2a2a]">Select Repository</h1>

      <p className="mb-6 text-sm text-gray-400">
        Configure the analysis context: choose the repository, branch, and scope type.
      </p>

      {submit_error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#cc2222]">
          {submit_error}
        </div>
      )}

      <form onSubmit={handle_submit} noValidate className="flex flex-col gap-5">
        {/* Repository selector */}
        <div className="flex flex-col gap-1">
          <label htmlFor="repo-select" className="text-sm font-medium text-[#2a2a2a]">
            Select repository 
          </label>
          <select
            id="repo-select"
            value={selected_repo ? `${selected_repo.owner}/${selected_repo.name}` : ""}
            onChange={(e) => {
              handle_repo_change(e.target.value);
              setFormErrors((p) => ({ ...p, repo: "" }));
            }}
            disabled={!!manual_repo_url.trim()}
            className="w-full rounded border border-[#cccccc] bg-white px-3 py-2 text-sm text-[#2a2a2a] outline-none focus:border-[#2277cc] focus:ring-2 focus:ring-[#2277cc]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">-- Select a repository --</option>
            {repos.map((r) => (
              <option key={`${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>
                {r.owner}/{r.name} {r.isPrivate ? "🔒" : ""}
              </option>
            ))}
          </select>
          {form_errors.repo && <span className="text-xs text-[#cc2222]">{form_errors.repo}</span>}
        </div>

        {/* Manual repository URL — for public repos not owned/collaborated by the connected GitHub account */}
        <ValidatedField
          label="Or paste the URL of a public repository"
          placeholder="https://github.com/owner/repo"
          value={manual_repo_url}
          onChange={(e) => {
            handle_manual_re
po_url_change(e.target.value);
            setFormErrors((p) => ({ ...p, repo: "", repo_url: "" }));
          }}
          disabled={!!selected_repo}
          error={form_errors.repo_url}  
          className="disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
        />

        {/* Branch */}
        <ValidatedField
          label="Branch"
          placeholder="main"
          value={ref}
          onChange={(e) => {
            setRef(e.target.value);
            setFormErrors((p) => ({ ...p, ref: "" }));
          }}
          error={form_errors.ref}
        />

        {/* Commit SHA (opzionale) */}
        <div className="flex flex-col gap-1">
          <ValidatedField
            label="Commit SHA (optional)"
            placeholder="leave empty for the latest commit on the branch"
            value={commit_sha}
            onChange={(e) => {
              setCommitSha(e.target.value);
              setFormErrors((p) => ({ ...p, commit_sha: "" }));
            }}
            error={form_errors.commit_sha}
          />
          <p className="text-xs text-gray-400">
            Pin the analysis to a specific commit, so the report stays reproducible even after
            new commits on the branch.
          </p>
        </div>

        {/* Scope type selector */}
        <div className="flex flex-col gap-1">
          <label htmlFor="scope-type" className="text-sm font-medium text-[#2a2a2a]">
            Scope type
          </label>
          <select
            id="scope-type"
            value={scope_type}
            onChange={(e) => {
              setScopeType(e.target.value as CreateContextDto["scopeType"]);
              setPathsText("");
              setFormErrors((p) => ({ ...p, paths: "" }));
            }}
            className="w-full rounded border border-[#cccccc] bg-white px-3 py-2 text-sm text-[#2a2a2a] outline-none focus:border-[#2277cc] focus:ring-2 focus:ring-[#2277cc]/20"
          >
            <option value="FU
LL_REPOSITORY">Full repository</option>
            <option value="FILES">File specifici</option>
            <option value="DIRECTORIES">Specific directories</option>
          </select>
          <p className="text-xs text-gray-400">
            {scope_type === "FULL_REPOSITORY" &&
              "All files in the repository will be included in the analysis."}
            {scope_type === "FILES" && "Specifica i file esatti da analizzare (uno per riga)."}
            {scope_type === "DIRECTORIES" && "Specify the directories to analyze (one per line)."}
          </p>
        </div>

        {/* Paths input — shown only when scope type requires it */}
        {requires_paths && (
          <div className="flex flex-col gap-1">
            <label htmlFor="paths-input" className="text-sm font-medium text-[#2a2a2a]">
              {scope_type === "FILES" ? "Files to analyze" : "Directories to analyze"}
            </label>
            <textarea
              id="paths-input"
              rows={5}
              placeholder={
                scope_type === "FILES"
                  ? "src/controllers/auth.ts\nsrc/models/user.ts"
                  : "src/controllers\nsrc/models"
              }
              value={paths_text}
              onChange={(e) => {
                setPathsText(e.target.value);
                setFormErrors((p) => ({ ...p, paths: "" }));
              }}
              className="w-full rounded border border-[#cccccc] bg-white px-3 py-2 text-sm font-mono text-[#2a2a2a] outline-none focus:border-[#2277cc] focus:ring-2 focus:ring-[#2277cc]/20 resize-y"
            />
            <p className="text-xs text-gray-400">
              One path per line, relative to the repository root.
            </p>
            {form_errors.paths && (
              <span className="text-xs text-[#cc2222]">{form_errors.paths}</span>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
        
  className="flex items-center justify-center gap-2 rounded bg-[#2a2a2a] px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-200 transition disabled:opacity-60"
        >
          {submitting && <Spinner size="sm" className="text-white" />}
          Save context and go to Start
        </button>
      </form>
    </div>
  );
}
