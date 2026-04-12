/**
 * Test whether a filename matches the numeric chapter pattern (e.g. "1.md", "42.md").
 */
export function isNumericMdFile(name: string): boolean {
  return /^\d+\.md$/.test(name);
}

/**
 * Sort comparator for filenames by their leading numeric value.
 * E.g. "2.md" < "10.md".
 */
export function numericSort(a: string, b: string): number {
  return parseInt(a, 10) - parseInt(b, 10);
}
