export type SortDirection = 'asc' | 'desc'

/**
 * Compares two possibly-null sortable values for a report query's in-memory
 * sort. Numbers compare numerically; everything else compares as a
 * locale-aware (pt-BR) string, which also covers `YYYY-MM-DD` date strings
 * since lexicographic and chronological order coincide for that format.
 * `null` always sorts last regardless of direction, so flipping the
 * direction reorders the real values without shuffling "no data" rows to the
 * top.
 */
export function compareSortValues(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'pt-BR')
}

/** Applies `dir` to a comparator built from `compareSortValues`. */
export function directionalCompare(
  a: string | number | null,
  b: string | number | null,
  dir: SortDirection,
): number {
  const cmp = compareSortValues(a, b)
  return dir === 'asc' ? cmp : -cmp
}
