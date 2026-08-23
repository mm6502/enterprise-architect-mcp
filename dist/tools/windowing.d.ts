import { z } from "zod";
/**
 * A result set worth more than this many windows cannot be usefully paged through,
 * so the response describes its shape instead of only sampling it.
 */
export declare const BREAKDOWN_LIMIT_FACTOR = 10;
export declare const offsetParam: z.ZodDefault<z.ZodNumber>;
/**
 * A window of zero or fewer rows cannot advance, so a continuation built from it would
 * repeat the same call forever — and a negative LIMIT makes SQLite return every row.
 */
export declare const limitParam: (fallback: number) => z.ZodDefault<z.ZodNumber>;
export declare function isTruncated(offset: number, returned: number, totalMatched: number): boolean;
export declare function buildContinuation<T extends Record<string, unknown>>(tool: string, args: T, offset: number, returned: number, totalMatched: number): {
    tool: string;
    arguments: T & {
        offset: number;
    };
} | undefined;
export declare function breakdownApplies(totalMatched: number, limit: number): boolean;
export interface BreakdownAxis {
    values: {
        value: string;
        count: number;
    }[];
    totalMatched: number;
    returned: number;
    truncated: boolean;
}
export declare function buildAxis(counts: Map<string, number>): BreakdownAxis | undefined;
/** Tallies a filterable column, skipping blanks: a blank is not an argument a caller can pass back. */
export declare function countBy<T>(rows: T[], pick: (row: T) => unknown): Map<string, number>;
/**
 * Assembles the axes a tool offers, keyed by the parameter name each one narrows.
 * An axis passed as undefined is one whose filter the caller already supplied.
 */
export declare function buildBreakdown(axes: Record<string, Map<string, number> | undefined>): Record<string, BreakdownAxis> | undefined;
