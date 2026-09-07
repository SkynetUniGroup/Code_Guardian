import type { Severity } from '../../types';
import { cn } from '../../lib/utils';

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

/**
 * Maps each severity level to its Tailwind colour classes.
 * Exact hex values match the wireframe CSS custom properties.
 */
const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'bg-[#cc2222] text-white',
  high: 'bg-[#e05800] text-white',
  medium: 'bg-[#f0ad00] text-white',
  low: 'bg-[#2277cc] text-white',
  info: 'bg-[#888888] text-white',
};

/** Human-readable Italian severity labels. */
const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critico',
  high: 'Alto',
  medium: 'Medio',
  low: 'Basso',
  info: 'Info',
};

/**
 * Displays a coloured pill badge for a security finding or policy-violation severity.
 */
export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase',
        SEVERITY_STYLES[severity],
        className,
      )}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
