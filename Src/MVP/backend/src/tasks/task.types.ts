import { ErrorKind } from '../common/exceptions/error-kind';

export type TaskStatus =
  'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

// Task uses `code`; Report's equivalent structure uses `kind` for the same
// value domain — two different field names for the same thing, kept as-is
// deliberately (see §11.2): the frontend already reads Task's error.code by
// name (tasksStore, task.failed handling), so renaming it isn't free.
export interface TaskError {
  code: ErrorKind;
  message: string;
  stage: string;
}

export type PendingInput =
  | { kind: 'SPRINT_ID' }
  | { kind: 'INCOMPLETE_TASKS'; taskIds: string[] }
  | { kind: 'BUSINESS_CONFIRMATION'; technicalReportId: string }
  | null;
