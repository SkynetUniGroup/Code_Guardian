import type { TaskStatus } from '../../types';
import { cn } from '../../lib/utils';

interface StatusBadgeProps {
  status: TaskStatus;
  className?: string;
}

/**
 * Maps each task status to its Tailwind background and text colour classes.
 * Colours mirror the CSS custom properties defined in index.css and the wireframe.
 */
const STATUS_STYLES: Record<TaskStatus, string> = {
  PENDING: 'bg-[#f0ad00] text-white',
  RUNNING: 'bg-[#2277cc] text-white',
  COMPLETED: 'bg-[#2a8a2a] text-white',
  FAILED: 'bg-[#cc2222] text-white',
  CANCELLED: 'bg-[#888888] text-white',
};

/** Human-readable Italian labels shown inside the badge. */
const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: 'In attesa',
  RUNNING: 'In esecuzione',
  COMPLETED: 'Completato',
  FAILED: 'Fallito',
  CANCELLED: 'Annullato',
};

/**
 * Displays a coloured pill badge reflecting the current status of a task or report.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
