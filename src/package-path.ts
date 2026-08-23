import type { Database } from "./database.js";

/**
 * Build the full package path from root to the given package, dot-separated.
 * Uses a preloaded package map memoized per database connection.
 */

const packageMaps = new WeakMap<Database, Map<number, { name: string; parentId: number }>>();

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
