/**
 * Build the full package path from root to the given package, dot-separated.
 * Uses a preloaded package map memoized per database connection.
 */
const packageMaps = new WeakMap();
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
