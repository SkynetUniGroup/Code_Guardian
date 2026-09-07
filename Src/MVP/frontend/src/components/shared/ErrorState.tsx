import { cn } from '../../lib/utils';

interface ErrorStateProps {
  /** Primary error message shown to the user. */
  message: string;

  /**
   * Optional action element (e.g. a Retry button or a link to /credentials).
   * Rendered below the message.
   */
  action?: React.ReactNode;

  className?: string;
}

/**
 * Full-area error display component.
 * Used when a page-level fetch fails or an operation error needs prominent display.
 *
 * Error messages are sourced from the execution error table in Progettazione.pdf
 * and rendered verbatim — callers are responsible for mapping backend error codes
 * to human-readable strings before passing them here.
 */
export function ErrorState({ message, action, className }: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-lg border border-red-200 bg-red-50 p-8 text-center',
        className,
      )}
    >
      {/* Error icon */}
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <svg
          className="h-6 w-6 text-red-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
      </div>

      <p className="text-sm font-medium text-red-700">{message}</p>

      {action && <div>{action}</div>}
    </div>
  );
}
