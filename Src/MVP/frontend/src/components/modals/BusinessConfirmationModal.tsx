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

  /** Il changelog tecnico appena prodotto, in Markdown. */
  technicalChangelog: string;

  /** Vero se il testo è stato tagliato perché troppo lungo. */
  technicalChangelogTruncated?: boolean;

  /** Called after submission or cancel. */
  onClose: () => void;
}

/**
 * Finestra di conferma fra la fase tecnica e quella business del changelog.
 *
 * L'agente Changelog produce prima la versione tecnica, poi si ferma e chiede
 * conferma prima di riscriverla per un pubblico non tecnico. Qui l'utente la
 * legge e decide.
 *
 * Due cose che questa finestra prima sbagliava:
 *
 * 1. Offriva un collegamento a `/reports/{technicalReportId}` — un `<a href>`
 *    con target="_blank", quindi un caricamento completo in una scheda nuova.
 *    Il JWT vive solo in memoria per scelta (vedi sessionStore), quindi la
 *    scheda nuova nasceva senza sessione e la guardia rimandava al login. E
 *    l'id era comunque vuoto: in questo istante un Report tecnico non esiste
 *    ancora, perché le due fasi stanno dentro un solo Task e il Report nasce
 *    alla fine. Adesso il testo arriva insieme alla richiesta e si legge qui,
 *    senza uscire dalla pagina.
 *
 * 2. Parlava di Pull Request. L'agente Changelog non produce nessuna Proposal
 *    (ChangelogBusinessProfile.parse_output restituisce None in entrambe le
 *    fasi), quindi nessuna PR viene mai aperta: confermare qui vuol dire
 *    "procedi a generare la versione business", nient'altro.
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
      setError("Impossibile inviare la risposta. Riprova.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalOverlay open title="Rivedi il changelog tecnico" onClose={onClose}>
      <p className="mb-4 text-sm text-gray-500">
        Il changelog tecnico è pronto. Rileggilo qui sotto: confermando, l'agente lo riscriverà in
        una versione comprensibile a chi non conosce il codice.
      </p>

      {technicalChangelog ? (
        <div className="mb-4 max-h-72 overflow-auto">
          <TextBlockRenderer
            block={{ kind: "TEXT", order: 0, markdown: technicalChangelog }}
          />
        </div>
      ) : (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-[#8a5a00]">
          Il testo del changelog tecnico non è arrivato insieme alla richiesta. Puoi comunque
          procedere: la versione business verrà generata lo stesso, e il report finale conterrà
          entrambe.
        </p>
      )}

      {technicalChangelogTruncated && (
        <p className="mb-4 text-xs text-gray-500">
          Anteprima troncata perché molto lunga. Il changelog completo finisce comunque nel report.
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
          Interrompi
        </button>

        <button
          type="button"
          onClick={() => submit("PROCEED")}
          disabled={loading}
          className="flex items-center gap-2 rounded bg-[#2a8a2a] px-4 py-2 text-sm font-medium text-white hover:bg-[#1e6b1e] transition disabled:opacity-50"
        >
          {loading && <Spinner size="sm" className="text-white" />}
          Genera la versione business
        </button>
      </div>
    </ModalOverlay>
  );
}
