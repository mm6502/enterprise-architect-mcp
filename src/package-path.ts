import type { Database } from "./database.js";
import { foldText } from "./text.js";

/**
 * Build the full package path from root to the given package, dot-separated.
 * Uses a preloaded package map memoized per database connection.
 */

const packageMaps = new WeakMap<Database, Map<number, { name: string; parentId: number }>>();
const childrenMaps = new WeakMap<Database, Map<number, number[]>>();

function getPackageMap(db: Database): Map<number, { name: string; parentId: number }> {
  let map = packageMaps.get(db);
  if (map) return map;

  map = new Map();
  const rows = db
    .prepare("SELECT Package_ID, Name, Parent_ID FROM t_package")
    .all() as { Package_ID: number; Name: string; Parent_ID: number }[];

  for (const row of rows) {
    map.set(row.Package_ID, { name: row.Name, parentId: row.Parent_ID });
  }
  packageMaps.set(db, map);
  return map;
}

/** Parent-to-children index, built once from the same map buildPackagePath reads upward. */
function getChildrenMap(db: Database): Map<number, number[]> {
  let map = childrenMaps.get(db);
  if (map) return map;

  map = new Map();
  for (const [id, pkg] of getPackageMap(db)) {
    const siblings = map.get(pkg.parentId);
    if (siblings) siblings.push(id);
    else map.set(pkg.parentId, [id]);
  }
  childrenMaps.set(db, map);
  return map;
}

export function buildPackagePath(db: Database, packageId: number): string {
  const map = getPackageMap(db);
  const parts: string[] = [];
  let current = packageId;
  const visited = new Set<number>();

  while (current > 0) {
    if (visited.has(current)) break;
    visited.add(current);
    const pkg = map.get(current);
    if (!pkg) break;
    parts.unshift(pkg.name);
    current = pkg.parentId;
  }

  return parts.join(".");
}

/** The scope package plus every descendant, walked down the same hierarchy buildPackagePath walks up. */
export function getPackageSubtree(db: Database, rootId: number): Set<number> {
  const children = getChildrenMap(db);
  const result = new Set<number>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of children.get(current) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        stack.push(child);
      }
    }
  }
  return result;
}

export type PackageScopeResolution =
  | { kind: "found"; packageId: number }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: { id: number; fullPackagePath: string }[] };

/** Resolves a package id or name to a single package, the way ea_resolve resolves a name to a candidate. */
export function resolvePackageScope(db: Database, scope: number | string): PackageScopeResolution {
  const map = getPackageMap(db);

  if (typeof scope === "number") {
    return map.has(scope) ? { kind: "found", packageId: scope } : { kind: "not_found" };
  }

  const folded = foldText(scope);
  const matches: number[] = [];
  for (const [id, pkg] of map) {
    if (foldText(pkg.name) === folded) matches.push(id);
  }

  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length === 1) return { kind: "found", packageId: matches[0] };
  return { kind: "ambiguous", candidates: matches.map((id) => ({ id, fullPackagePath: buildPackagePath(db, id) })) };
}
