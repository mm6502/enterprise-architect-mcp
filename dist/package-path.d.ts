import type { Database } from "./database.js";
export declare function buildPackagePath(db: Database, packageId: number): string;
/** The scope package plus every descendant, walked down the same hierarchy buildPackagePath walks up. */
export declare function getPackageSubtree(db: Database, rootId: number): Set<number>;
export type PackageScopeResolution = {
    kind: "found";
    packageId: number;
} | {
    kind: "not_found";
} | {
    kind: "ambiguous";
    candidates: {
        id: number;
        fullPackagePath: string;
    }[];
};
/** Resolves a package id or name to a single package, the way ea_resolve resolves a name to a candidate. */
export declare function resolvePackageScope(db: Database, scope: number | string): PackageScopeResolution;
