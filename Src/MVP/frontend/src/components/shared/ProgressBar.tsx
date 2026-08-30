import { cn } from '../../lib/utils';

interface ProgressBarProps {
  /** Current progress value, 0–100. */
  value: number;

  /** Optional current stage label shown below the bar. */
  stage?: string | null;

  className?: string;
}

/**
 * Horizontal progress bar used on task cards in the /tasks dashboard.
 * The fill colour uses the running-status blue from the wireframe design tokens.
 */
export function ProgressBar({ value, stage, className }: ProgressBarProps) {
  // Clamp value to [0, 100] to guard against backend anomalies.
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {/* Track */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* Fill */}
        <div
          className="h-full rounded-full bg-[#2277cc] transition-all duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>

      {stage && (
        <span className="text-xs text-gray-500 truncate">{stage}</span>
      )}
    </div>
  );
}
