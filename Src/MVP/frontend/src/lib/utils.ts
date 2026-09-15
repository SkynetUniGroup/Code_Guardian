import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { OperationCode } from "../types";
import { OPERATION_LABELS } from "../types";

/**
 * Merges Tailwind CSS class names, resolving conflicts.
 * Uses clsx for conditional class application and tailwind-merge
 * to deduplicate conflicting Tailwind utility classes.
 *
 * @param inputs - One or more class value expressions (strings, arrays, objects)
 * @returns A single merged class name string
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function buildReportPdfFilename(report: {
  operation: OperationCode;
  generatedAt: string;
  context: { repoOwner: string; repoName: string };
}): string {
  const operationLabel = OPERATION_LABELS[report.operation];
  const date = report.generatedAt.slice(0, 10); // YYYY-MM-DD

  const raw = `${operationLabel}-${report.context.repoOwner}-${report.context.repoName}-${date}`;

  const slug = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${slug}.pdf`;
}
