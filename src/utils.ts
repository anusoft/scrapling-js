/**
 * Utility functions for scrapling-js
 */

/**
 * Flatten an array of arrays into a single array.
 */
export function flatten<T>(arrays: T[][]): T[] {
  return arrays.reduce<T[]>((acc, arr) => acc.concat(arr), []);
}

/**
 * Clean whitespace from a string:
 * - Replace tabs with spaces
 * - Remove carriage returns
 * - Replace newlines with spaces
 * - Collapse consecutive spaces into one
 * - Trim leading/trailing whitespace
 */
export function cleanSpaces(s: string): string {
  return s
    .replace(/\t/g, " ")
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}
