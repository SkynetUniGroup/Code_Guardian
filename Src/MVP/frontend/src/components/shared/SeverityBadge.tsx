import { cn } from "../../lib/utils";
import type { Severity } from "../../types";

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

/**
 * Maps each severity level to its Tailwind colour classes.
 * Exact hex values match the wireframe CSS custom properties.
 */
const SEVERITY_STYLES: Record<Severity, string> = {
  CRITICAL: "bg-[#cc2222] text-white",
  HIGH: "bg-[#e05800] text-white",
  MEDIUM: "bg-[#f0ad00] text-white",
  LOW: "bg-[#2277cc] text-white",
  INFO: "bg-[#888888] text-white",
};

/** Human-readable Italian severity labels. */
const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: "Critico",
  HIGH: "Alto",
  MEDIUM: "Medio",
  LOW: "Basso",
  INFO: "Info",
};

/**
 * Displays a coloured pill badge for a security finding or policy-violation severity.
 */
export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase",
        SEVERITY_STYLES[severity] ?? "bg-gray-100 text-[#2a2a2a]",
        className,
      )}
    >
      {SEVERITY_LABELS[severity] ?? severity}
    </span>
  );
}
