import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { toApiError } from "../api/errors";
import { ErrorState } from "../components/shared/ErrorState";
import { Spinner } from "../components/shared/Spinner";
import { useSelectionStore } from "../stores/selectionStore";
import { useTasksStore } from "../stores/tasksStore";
import { OPERATION_LABELS } from "../types";
import type { CreateTaskBatchDto, OperationCode, OperationDescriptorDto } from "../types";

/**
 * RunPage — /run
 *
 * Shows the operations available to the user by reading them from GET /operations:
 * it is the backend (AgentRegistry) that filters them by role, and it is always the backend that
 * rejects with 403 an unauthorized operation. A role→operations table
 * replicated here could only diverge from the one actually applied.
 *
 * This page reads the analysis context set by /select from the selectionStore.
 * If no context has been selected, the user is prompted to go back to /select.
 *
 * Flow:
 *  1. Reads contextId and context metadata from selectionStore.
 *  2. User selects one or more operation cards from those allowed by their role.
 *  3. POSTs CreateTaskBatchDto { contextId, operations[] } to /tasks.
 *  4. On success, clears the selection and redirects to /tasks.
 */
export function RunPage() {
  const navigate = useNavigate();
  const { contextId, context, clearContext } = useSelectionStore();
  const setCurrentBatch = useTasksStore((s) => s.setCurrentBatch);

  // Set of selected operations — the batch can contain more than one.
  const [selected_ops, setSelectedOps] = useState<Set<OperationCode>>(new Set());
  const [launching, setLaunching] = useState(false);
  const [launch_error, setLaunchError] = useState("");

  const [available_ops, setAvailableOps] = useState<OperationDescriptorDto[]>([]);
  const [ops_loading, setOpsLoading] = useState(true);
  const [ops_error, setOpsError] = useState("");

  useEffect(() => {
    async function fetch_operations() {
      try {
        const response = await apiClient.get<OperationDescriptorDto[]>("/operations");
        setAvailableOps(response.data);
      } catch {
        setOpsError("Unable to load available operations. Try again later.");
      } finally {
        setOpsLoading(false);
      }
    }
    fetch_operations();
  }, []);

  /**
   * Toggles a single operation in/out of the selection set.
   */
  function toggle_op(op: OperationCode) {
    setSelectedOps((prev) => {
      const next = new Set(prev);
      if (next.has(op)) {
        next.delete(op);
      } else {
        next.add(op);
      }
      return next;
    });
    setLaunchError("");
  }

  async function handle_launch() {
    if (selected_ops.size === 0 || !contextId) return;

    setLaunching(true);
    setLaunchError("");

    const dto: CreateTaskBatchDto = {
      contextId,
      operations: Array.from(selected_ops),
    };

    try {
      const response = await apiClient.post<{ taskIds: string[]; batchId: string }>("/tasks", dto);
      setCurrentBatch(response.data.batchId);
      navigate({ to: "/tasks" });
    } catch (err: unknown) {
      const { status, message } = toApiError(err);
      if (status === 429) {
        // USAGE_LIMIT_EXCEEDED (RF.66): the backend responds 429, not 402.
        setLaunchError(
          message ?? "You have reached the monthly operation limit; try again next month.",
        );
      } else if (status === 403) {
        setLaunchError("Your role is not enabled for one of the selected operations.");
      } else if (status === 404) {
        setLaunchError("Context not found. Go back to Repository and recreate the analysis context.");
      } else {
        setLaunchError("Error starting operations. Try again.");
      }
    } finally {
      setLaunching(false);
    }
  }

  // ---- Render ----

  // Guard: if no context has been selected, show a prompt to go to /select.
  if (!contextId || !context) {
    return (
      <ErrorState
        message="No context configured. Go to Repository to select a repository and configure the analysis."
        action={
          <button
            type="button"
            onClick={() => navigate({ to: "/select" })}
            className="rounded bg-[#2277cc] px-3 py-1.5 text-sm text-white hover:bg-[#1a5fa8]"
          >
            Go to Repository
          </button>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-[#2a2a2a]">Start Operations</h1>
      <p className="mb-6 text-sm text-gray-400">
        Select one or more operations to start on the current context.
      </p>

      {/* Context summary — shows which repo and scope is currently active */}
      <div className="mb-6 rounded-lg border border-[#cccccc] bg-gray-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Active context
        </p>
        <p className="text-sm font-medium text-[#2a2a2a]">
          {context.repoOwner}/{context.repoName}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          SHA: <span className="font-mono">{context.resolvedSha.slice(0, 8)}</span>
          {" · "}Scope: {context.scopeType}
          {context.detectedLanguages.length > 0 && (
            <>
              {" · "}
              {context.detectedLanguages.join(", ")}
            </>
          )}
          {" · "}
          {context.estimatedFileCount} estimated files
        </p>
        {/* RV.8: non-blocking warning computed by the backend at context creation.
            The field arrived in the DTO with a TODO and was never
            displayed, so the user did not know that the generated documentation
            could be affected by a README in another language. */}
        {context.nonEnglishReadmeDetected && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-[#8a5a00]">
            This repository's README does not appear to be in English: agents work better on
            English content, results may be less accurate.
          </p>
        )}
        {/* RF.24: same treatment as RV.8 above — non-blocking warning,
            computed by the backend at context creation. It appears when the
            predominant language is not among the three supported: it is the case where
            the analysis would see a minimal fraction of the repository, and without
            saying it a nearly empty report would look like a nearly clean repository. */}
        {context.unsupportedLanguageWarning && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-[#8a5a00]">
            This repository is primarily written in{" "}
            <span className="font-medium">{context.predominantLanguage}</span>, which agents cannot
            analyze: only TypeScript, JavaScript and Python files will be examined
            {context.detectedLanguages.length === 0 ? ", which are not present here" : ""}.
            {context.unsupportedLanguages.length > 1 && (
              <>
                {" "}
                Other unsupported languages: {context.unsupportedLanguages.slice(1).join(", ")}.
              </>
            )}
          </p>
        )}

        {/* Link to change context */}
        <button
          type="button"
          onClick={() => navigate({ to: "/select" })}
          className="mt-2 text-xs text-[#2277cc] hover:underline"
        >
          Change context
        </button>
      </div>

      {ops_error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#cc2222]">
          {ops_error}
        </div>
      )}

      {ops_loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner size="sm" />
          Loading operations…
        </div>
      )}

      {/* Operation cards — multi-select */}
      <p className="mb-3 text-sm font-medium text-[#2a2a2a]">
        Operations <span className="font-normal text-gray-400">(you can select more than one)</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {available_ops.map((op) => {
          const is_selected = selected_ops.has(op.code);
          return (
            <button
              type="button"
              key={op.code}
              onClick={() => toggle_op(op.code)}
              aria-pressed={is_selected}
              className={[
                "rounded-lg border p-4 text-left transition",
                is_selected
                  ? "border-[#2277cc] bg-[#2277cc]/5 ring-2 ring-[#2277cc]/30"
                  : "border-[#cccccc] bg-white hover:border-[#2277cc]/50 hover:bg-gray-50",
              ].join(" ")}
            >
              {/* Agent executing the operation (DOCS, SECURITY, CHANGELOG) */}
              <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                {op.agent}
              </span>
              {/* The localized label, the same one used by TasksPage, ReportsPage
                  and ReportDetailPage: the displayName that comes from GET /operations
                  is in English, and here the user chose "OWASP Top 10
                  vulnerability scan" only to find it everywhere as "Security
                  OWASP Analysis". The displayName remains the fallback if one day
                  the backend introduces a code that the map does not know. */}
              <span className="block text-sm font-medium text-[#2a2a2a]">
                {OPERATION_LABELS[op.code] ?? op.displayName}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-gray-500">
                {op.description}
              </span>
              {/* Visual selected indicator */}
              {is_selected && (
                <span className="mt-2 inline-block rounded-full bg-[#2277cc] px-2 py-0.5 text-[10px] font-semibold text-white">
                  Selected
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Error */}
      {launch_error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#cc2222]">
          {launch_error}
        </div>
      )}

      {/* Launch button */}
      <button
        type="button"
        onClick={handle_launch}
        disabled={selected_ops.size === 0 || launching}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded bg-[#2a2a2a] px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-200 transition disabled:opacity-50"
      >
        {launching && <Spinner size="sm" className="text-white" />}
        {selected_ops.size === 0
          ? "Select at least one operation"
          : selected_ops.size === 1
            ? "Start operation"
            : `Start ${selected_ops.size} operations`}
      </button>
    </div>
  );
}
