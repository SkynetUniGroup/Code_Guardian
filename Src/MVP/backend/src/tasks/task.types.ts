import type { ErrorKind } from "../common/exceptions/error-kind";

export type { PendingInput, TaskStatus } from "@codeguardian/shared";

// Versione ristretta di TaskError (shared) usata *dentro* il backend: `code` è
// un ErrorKind, non una stringa qualsiasi. Sul filo resta assegnabile al tipo
// condiviso — ErrorKind è un sottoinsieme di string — ma qui dentro impedisce
// di scrivere un codice che il catalogo di BE-2 non prevede, ed è ciò che
// permette a ReportAssemblyService di travasarlo in ReportError.kind senza
// cast.
export interface TaskError {
  code: ErrorKind;
  message: string;
  stage: string;
}

/*export type TaskStatus =
  'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';*/

/*export type PendingInput =
  | { kind: 'SPRINT_ID' }
  | { kind: 'INCOMPLETE_TASKS'; taskIds: string[] }
  | { kind: 'BUSINESS_CONFIRMATION'; technicalReportId: string }
  | null;*/
