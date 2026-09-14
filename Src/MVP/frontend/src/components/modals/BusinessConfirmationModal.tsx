import { useState } from "react";
import { apiClient } from "../../api/client";
import { TextBlockRenderer } from "../../components/report/TextBlockRenderer";
import { useTasksStore } from "../../stores/tasksStore";
import type { SubmitInputDto } from "../../types";
import { Spinner } from "../shared/Spinner";
import { ModalOverlay } from "./ModalOverlay";

interface BusinessConfirmationModalProps {
  /** ID of the paused task (CHANGELOG_BUSINESS). */
  taskId: string;

  /** The technical changelog just produced, in Markdown. */
  technicalChangelog: string;

  /** True if the text was truncated because it was too long. */
  technicalChangelogTruncated?: boolean;

  /** Called after submission or cancel. */
  onClose: () => void;
}

/**
 * Confirmation dialog between the technical and business phases of the changelog.
 *
 * The Changelog agent first produces the technical version, then pauses and
 * asks for confirmation before rewriting it for a non-technical audience. Here
 * the user reads it and decides.
 *
 * Two things this dialog previously got wrong:
 *
 * 1. It offered a link to `/reports/{technicalReportId}` — an `<a href>`
 *    with target="_blank", so a full page load in a new tab. The JWT lives only
 *    in memory by design (see sessionStore), so the new tab was born without a
 *    session and the guard redirected to login. And the id was empty anyway:
 *    at this point a technical Report does not exist yet, because the two
 *    phases live inside a single Task and the Report is created at the end.
 *    Now the text arrives together with the request and is read here, without
 *    leaving the page.
 *
 * 2. It mentioned Pull Requests. The Changelog agent does not produce any
 *    Proposal (ChangelogBusinessProfile.parse_output returns None in both
 *    phases), so no PR is ever opened: confirming here means "proceed to
 *    generate the business version", nothing else.
 */
export function BusinessConfirmationModal({
  taskId,
  technicalChangelog,
  technicalChangelogTruncated = false,
  onClose,
}: BusinessConfirmationModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const clear_pending = useTasksStore((s) => s.clearPendingInput);

  async function submit(action: "PROCEED" | "CANCEL") {
    const dto: SubmitInputDto = { kind: "BUSINESS_CONFIRMATION", action };
    setLoading(true);
    setError("");
    try {
      await apiClient.post(`/tasks/${taskId}/input`, dto);
      clear_pending(taskId);
      onClose();
    } catch {
      setError("Unable to send the response. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalOverlay open title="Review the technical changelog" onClose={onClose}>
      <p className="mb-4 text-sm text-gray-500">
        The technical changelog is ready. Read it below: by confirming, the agent will rewrite it
        in a version understandable to someone who does not know the code.
      </p>

      {technicalChangelog ? (
        <div className="mb-4 max-h-72 overflow-auto">
          <TextBlockRenderer
            block={{ kind: "TEXT", order: 0, markdown: technicalChangelog }}
          />
        </div>
      ) : (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-[#8a5a00]">
          The technical changelog text did not arrive with the request. You can still proceed: the
          business version will be generated anyway, and the final report will contain both.
        </p>
      )}

      {technicalChangelogTruncated && (
        <p className="mb-4 text-xs text-gray-500">
          Preview truncated because it was very long. The full changelog still ends up in the
          report.
        </p>
      )}

      {error && <p className="mb-3 text-xs text-[#cc2222]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => submit("CANCEL")}
          disabled={loading}
          className="rounded border border-[#cccccc] px-4 py-2 text-sm text-[#2a2a2a] hover:bg-gray-50 transition disabled:opacity-50"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={() => submit("PROCEED")}
          disabled={loading}
          className="flex items-center gap-2 rounded bg-[#2a8a2a] px-4 py-2 text-sm font-medium text-white hover:bg-[#1e6b1e] transition disabled:opacity-50"
        >
          {loading && <Spinner size="sm" className="text-white" />}
          Generate business version
        </button>
      </div>
    </ModalOverlay>
  );
}
