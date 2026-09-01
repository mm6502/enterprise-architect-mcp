import { foldText } from "./text.js";
/**
 * Build the full package path from root to the given package, dot-separated.
 * Uses a preloaded package map memoized per database connection.
 */
const packageMaps = new WeakMap();
const childrenMaps = new WeakMap();
function getPackageMap(db) {
    let map = packageMaps.get(db);
    if (map)
        return map;
    map = new Map();
    const rows = db
        .prepare("SELECT Package_ID, Name, Parent_ID FROM t_package")
        .all();
    for (const row of rows) {
        map.set(row.Package_ID, { name: row.Name, parentId: row.Parent_ID });
    }
    packageMaps.set(db, map);
    return map;
}
/** Parent-to-children index, built once from the same map buildPackagePath reads upward. */
function getChildrenMap(db) {
    let map = childrenMaps.get(db);
    if (map)
        return map;
    map = new Map();
    for (const [id, pkg] of getPackageMap(db)) {
        const siblings = map.get(pkg.parentId);
        if (siblings)
            siblings.push(id);
        else
            map.set(pkg.parentId, [id]);
    }
    childrenMaps.set(db, map);
    return map;
}
export function buildPackagePath(db, packageId) {
    const map = getPackageMap(db);
    const parts = [];
    let current = packageId;
    const visited = new Set();
    while (current > 0) {
        if (visited.has(current))
            break;
        visited.add(current);
        const pkg = map.get(current);
        if (!pkg)
            break;
        parts.unshift(pkg.name);
        current = pkg.parentId;
    }
    return parts.join(".");
}
/** The scope package plus every descendant, walked down the same hierarchy buildPackagePath walks up. */
export function getPackageSubtree(db, rootId) {
    const children = getChildrenMap(db);
    const result = new Set([rootId]);
    const stack = [rootId];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const child of children.get(current) ?? []) {
            if (!result.has(child)) {
                result.add(child);
                stack.push(child);
            }
        }
    }
    return result;
}
/** Resolves a package id or name to a single package, the way ea_resolve resolves a name to a candidate. */
export function resolvePackageScope(db, scope) {
    const map = getPackageMap(db);
    if (typeof scope === "number") {
        return map.has(scope) ? { kind: "found", packageId: scope } : { kind: "not_found" };
    }
    const folded = foldText(scope);
    const matches = [];
    for (const [id, pkg] of map) {
        if (foldText(pkg.name) === folded)
            matches.push(id);
    }
    if (matches.length === 0)
        return { kind: "not_found" };
    if (matches.length === 1)
        return { kind: "found", packageId: matches[0] };
    return { kind: "ambiguous", candidates: matches.map((id) => ({ id, fullPackagePath: buildPackagePath(db, id) })) };
}
