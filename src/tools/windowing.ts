import { z } from "zod";

/**
 * A result set worth more than this many windows cannot be usefully paged through,
 * so the response describes its shape instead of only sampling it.
 */
export const BREAKDOWN_LIMIT_FACTOR = 10;

const MAX_BREAKDOWN_VALUES = 20;

export const offsetParam = z.coerce
  .number()
  .int()
  .min(0)
  .default(0)
  .describe("Zero-based index of the first result to return (default 0). Page by re-calling with the offset carried in continuation.");

/**
 * A window of zero or fewer rows cannot advance, so a continuation built from it would
 * repeat the same call forever — and a negative LIMIT makes SQLite return every row.
 */
export const limitParam = (fallback: number) =>
  z.coerce
    .number()
    .int()
    .min(1)
    .default(fallback)
    .describe(`Maximum number of results to return (default ${fallback})`);

export function isTruncated(offset: number, returned: number, totalMatched: number): boolean {
  return offset + returned < totalMatched;
}

export function buildContinuation<T extends Record<string, unknown>>(
  tool: string,
  args: T,
  offset: number,
  returned: number,
  totalMatched: number
): { tool: string; arguments: T & { offset: number } } | undefined {
  if (!isTruncated(offset, returned, totalMatched)) return undefined;
  return { tool, arguments: { ...args, offset: offset + returned } };
}

export function breakdownApplies(totalMatched: number, limit: number): boolean {
  return totalMatched > BREAKDOWN_LIMIT_FACTOR * limit;
}

export interface BreakdownAxis {
  values: { value: string; count: number }[];
  totalMatched: number;
  returned: number;
  truncated: boolean;
}

/**
 * Counts in, one breakdown axis out. Axis extraction stays with the tool, because
 * only the tool knows which of its parameters a column corresponds to.
 */
export function buildAxis(counts: Map<string, number>): BreakdownAxis | undefined {
  // One value only restates a filter the caller could already have applied.
  if (counts.size < 2) return undefined;

  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([value, count]) => ({ value, count }));

  const values = sorted.slice(0, MAX_BREAKDOWN_VALUES);
  return {
    values,
    totalMatched: sorted.length,
    returned: values.length,
    truncated: sorted.length > values.length,
  };
}

/** Tallies a filterable column, skipping blanks: a blank is not an argument a caller can pass back. */
export function countBy<T>(rows: T[], pick: (row: T) => unknown): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = pick(row);
    if (raw == null || raw === "") continue;
    const key = String(raw);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Assembles the axes a tool offers, keyed by the parameter name each one narrows.
 * An axis passed as undefined is one whose filter the caller already supplied.
 */
export function buildBreakdown(
  axes: Record<string, Map<string, number> | undefined>
): Record<string, BreakdownAxis> | undefined {
  const built: Record<string, BreakdownAxis> = {};
  for (const [parameter, counts] of Object.entries(axes)) {
    const axis = counts && buildAxis(counts);
    if (axis) built[parameter] = axis;
  }
  return Object.keys(built).length > 0 ? built : undefined;
}
