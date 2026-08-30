import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
