import { z } from "zod";
import { foldText } from "../text.js";
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
export const limitParam = (fallback) => z.coerce
    .number()
    .int()
    .min(1)
    .default(fallback)
    .describe(`Maximum number of results to return (default ${fallback})`);
export function isTruncated(offset, returned, totalMatched) {
    return offset + returned < totalMatched;
}
export function buildContinuation(tool, args, offset, returned, totalMatched) {
    if (!isTruncated(offset, returned, totalMatched))
        return undefined;
    return { tool, arguments: { ...args, offset: offset + returned } };
}
export function breakdownApplies(totalMatched, limit) {
    return totalMatched > BREAKDOWN_LIMIT_FACTOR * limit;
}
/**
 * Counts in, one breakdown axis out. Axis extraction stays with the tool, because
 * only the tool knows which of its parameters a column corresponds to.
 */
/**
 * The cap below makes the value list a truncated window, and under binary order every
 * accented value sorts past every plain one — so a tie at the cap would drop the
 * accented value every time. Folding first is locale-independent, unlike compareNames,
 * which matters because these values come back as filter arguments.
 */
function compareValues(a, b) {
    const foldedA = foldText(a);
    const foldedB = foldText(b);
    if (foldedA !== foldedB)
        return foldedA < foldedB ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
}
export function buildAxis(counts) {
    // One value only restates a filter the caller could already have applied.
    if (counts.size < 2)
        return undefined;
    const sorted = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || compareValues(a[0], b[0]))
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
export function countBy(rows, pick) {
    const counts = new Map();
    for (const row of rows) {
        const raw = pick(row);
        if (raw == null || raw === "")
            continue;
        const key = String(raw);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}
/**
 * Assembles the axes a tool offers, keyed by the parameter name each one narrows.
 * An axis passed as undefined is one whose filter the caller already supplied.
 */
export function buildBreakdown(axes) {
    const built = {};
    for (const [parameter, counts] of Object.entries(axes)) {
        const axis = counts && buildAxis(counts);
        if (axis)
            built[parameter] = axis;
    }
    return Object.keys(built).length > 0 ? built : undefined;
}
