import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { decodeEntities, foldText } from "../text.js";
import { breakdownApplies, buildBreakdown, buildContinuation, countBy, isTruncated, limitParam, offsetParam } from "./windowing.js";
const corpora = new WeakMap();
/** True when the query begins somewhere other than mid-word. */
function startsAtWordBoundary(text, query) {
    for (let idx = text.indexOf(query); idx > 0; idx = text.indexOf(query, idx + 1)) {
        if (!/[\p{L}\p{N}]/u.test(text[idx - 1]))
            return true;
    }
    return false;
}
/**
 * The ladder is injective on (sourceTable, sourceField) above rank 3, and ranks 0-3 all
 * resolve to t_object.Name. That is what makes `matchedIn` independent of corpus scan
 * order — collapsing any two of these ranks would put an unordered SELECT back in charge
 * of the answer. Coverage refines name and alias hits, where a query filling more of the
 * text is a stronger match; for notes it would only measure document length.
 */
function scoreMatch(entry, foldedQuery) {
    const text = entry.foldedText;
    const coverage = text.length > 0 ? foldedQuery.length / text.length : 0;
    if (entry.sourceTable === "t_object") {
        if (entry.sourceField === "Name") {
            if (text === foldedQuery)
                return { rank: 0, coverage: 1 };
            if (text.startsWith(foldedQuery))
                return { rank: 1, coverage };
            if (startsAtWordBoundary(text, foldedQuery))
                return { rank: 2, coverage };
            return { rank: 3, coverage };
        }
        if (entry.sourceField === "Alias")
            return { rank: 4, coverage };
        return { rank: 5, coverage: 0 };
    }
    if (entry.sourceTable === "t_attribute")
        return { rank: entry.sourceField === "Name" ? 6 : 8, coverage: 0 };
    if (entry.sourceTable === "t_operation")
        return { rank: entry.sourceField === "Name" ? 7 : 9, coverage: 0 };
    return { rank: 10, coverage: 0 };
}
function buildCorpus(db) {
    const cached = corpora.get(db);
    if (cached)
        return cached;
    const entries = [];
    // t_object: Name, Alias, Note
    const objects = db.prepare("SELECT Object_ID, Name, Alias, Note FROM t_object").all();
    for (const o of objects) {
        if (o.Name)
            entries.push({ sourceTable: "t_object", sourceId: o.Object_ID, sourceField: "Name", objectId: o.Object_ID, foldedText: foldText(decodeEntities(o.Name)) });
        if (o.Alias)
            entries.push({ sourceTable: "t_object", sourceId: o.Object_ID, sourceField: "Alias", objectId: o.Object_ID, foldedText: foldText(decodeEntities(o.Alias)) });
        if (o.Note)
            entries.push({ sourceTable: "t_object", sourceId: o.Object_ID, sourceField: "Note", objectId: o.Object_ID, foldedText: foldText(decodeEntities(o.Note)) });
    }
    // t_attribute: Name, Notes
    const attrs = db.prepare("SELECT ID, Object_ID, Name, Notes FROM t_attribute").all();
    for (const a of attrs) {
        if (a.Name)
            entries.push({ sourceTable: "t_attribute", sourceId: a.ID, sourceField: "Name", objectId: a.Object_ID, foldedText: foldText(decodeEntities(a.Name)) });
        if (a.Notes)
            entries.push({ sourceTable: "t_attribute", sourceId: a.ID, sourceField: "Notes", objectId: a.Object_ID, foldedText: foldText(decodeEntities(a.Notes)) });
    }
    // t_operation: Name, Notes
    const ops = db.prepare("SELECT OperationID, Object_ID, Name, Notes FROM t_operation").all();
    for (const op of ops) {
        if (op.Name)
            entries.push({ sourceTable: "t_operation", sourceId: op.OperationID, sourceField: "Name", objectId: op.Object_ID, foldedText: foldText(decodeEntities(op.Name)) });
        if (op.Notes)
            entries.push({ sourceTable: "t_operation", sourceId: op.OperationID, sourceField: "Notes", objectId: op.Object_ID, foldedText: foldText(decodeEntities(op.Notes)) });
    }
    // t_objectconstraint: Notes
    const constraints = db.prepare(`SELECT Object_ID, Notes FROM t_objectconstraint WHERE Notes IS NOT NULL AND Notes != ''`).all();
    for (const c of constraints) {
        entries.push({ sourceTable: "t_objectconstraint", sourceId: c.Object_ID, sourceField: "Notes", objectId: c.Object_ID, foldedText: foldText(decodeEntities(c.Notes)) });
    }
    corpora.set(db, entries);
    return entries;
}
export function configureSearchTools(server, model) {
    server.tool("ea_search", "Search Enterprise Architect model elements by name, alias, notes, attribute names/notes, operation names/notes, or constraint notes. Matching is case- and diacritic-insensitive across European Latin alphabets and sees through entity-encoded text. Matching elements are returned in `results`, strongest match first, each with a decoded note preview and a truncation flag; equally strong matches fall back to the model's internal identity, a stable but artificial order. Walk a large result set with `offset` rather than a larger `limit`; while rows remain, `continuation` names the next call. When far more elements match than one window can hold, `breakdown` reports how they distribute, so the next call can narrow by `objectType` or `stereotype` instead of paging.", {
        query: z.string().describe("Search term to find across all model text (names, notes, aliases, attributes, operations, constraints)"),
        objectType: z
            .string()
            .optional()
            .describe("Filter by object type (e.g., Class, UseCase, Activity, Screen, Requirement, Interface, Component)"),
        stereotype: z.string().optional().describe("Filter by stereotype"),
        limit: limitParam(25),
        offset: offsetParam,
    }, READ_ONLY, async ({ query, objectType, stereotype, limit, offset }) => {
        const db = await model.database();
        try {
            const entries = buildCorpus(db);
            const foldedQuery = foldText(query).trim();
            if (foldedQuery.length === 0) {
                return {
                    content: [{ type: "text", text: JSON.stringify({
                                results: [],
                                totalMatched: 0,
                                returned: 0,
                                offset,
                                truncated: false,
                                _meta: { sourceTables: ["t_object", "t_attribute", "t_operation", "t_objectconstraint", "t_package"] },
                                error: "Query is empty after normalization.",
                            }, null, 2) }],
                };
            }
            // Find matching object IDs with match quality ranking
            const matchMap = new Map();
            for (const entry of entries) {
                if (!entry.foldedText.includes(foldedQuery))
                    continue;
                const { rank, coverage } = scoreMatch(entry, foldedQuery);
                const existing = matchMap.get(entry.objectId);
                if (existing && (existing.rank < rank || (existing.rank === rank && existing.coverage >= coverage)))
                    continue;
                matchMap.set(entry.objectId, { rank, coverage, matchedIn: `${entry.sourceTable}.${entry.sourceField}` });
            }
            if (matchMap.size === 0) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                results: [],
                                totalMatched: 0,
                                returned: 0,
                                offset,
                                truncated: false,
                                _meta: { sourceTables: ["t_object", "t_attribute", "t_operation", "t_objectconstraint", "t_package"] },
                            }, null, 2),
                        }],
                };
            }
            // Strongest first, then identity: without the final tiebreak, paging a large
            // tie could show the same row twice and never show another.
            const sortedIds = [...matchMap.entries()]
                .sort((a, b) => a[1].rank - b[1].rank || b[1].coverage - a[1].coverage || a[0] - b[0])
                .map(([id]) => id);
            // Build SQL to fetch matched elements with filters
            let filterClauses = "";
            const filterParams = [];
            if (objectType) {
                filterClauses += " AND o.Object_Type = ?";
                filterParams.push(objectType);
            }
            if (stereotype) {
                filterClauses += " AND o.Stereotype = ?";
                filterParams.push(stereotype);
            }
            // Fetch all matching elements and apply filters
            const placeholders = sortedIds.map(() => "?").join(",");
            const sql = `
          SELECT o.Object_ID, o.Object_Type, o.Name, o.Alias, o.Stereotype,
                 o.Package_ID, p.Name as PackageName, o.Note
          FROM t_object o
          LEFT JOIN t_package p ON o.Package_ID = p.Package_ID
          WHERE o.Object_ID IN (${placeholders})${filterClauses}
        `;
            const allRows = db.prepare(sql).all(...sortedIds, ...filterParams);
            // IN (...) returns rows in whatever order the plan produces, so rank order is restored here.
            const rowMap = new Map(allRows.map((r) => [r.Object_ID, r]));
            const totalMatched = sortedIds.filter((id) => rowMap.has(id)).length;
            const sorted = sortedIds
                .filter((id) => rowMap.has(id))
                .map((id) => rowMap.get(id));
            const window = sorted.slice(offset, offset + limit);
            const truncated = isTruncated(offset, window.length, totalMatched);
            const results = window.map((r) => {
                const decodedNote = decodeEntities(r.Note);
                const notePreview = decodedNote ? decodedNote.slice(0, 200) : null;
                const notePreviewTruncated = decodedNote != null && decodedNote.length > 200;
                return {
                    Object_ID: r.Object_ID,
                    Object_Type: r.Object_Type,
                    Name: r.Name,
                    Alias: r.Alias,
                    Stereotype: r.Stereotype,
                    Package_ID: r.Package_ID,
                    PackageName: r.PackageName,
                    NotePreview: notePreview,
                    notePreviewTruncated,
                    matchedIn: matchMap.get(r.Object_ID)?.matchedIn ?? null,
                };
            });
            const breakdown = breakdownApplies(totalMatched, limit)
                ? buildBreakdown({
                    objectType: objectType ? undefined : countBy(sorted, (r) => r.Object_Type),
                    stereotype: stereotype ? undefined : countBy(sorted, (r) => r.Stereotype),
                })
                : undefined;
            const continuation = buildContinuation("ea_search", { query, objectType, stereotype, limit }, offset, results.length, totalMatched);
            const response = {
                results,
                totalMatched,
                returned: results.length,
                offset,
                truncated,
                ...(breakdown ? { breakdown } : {}),
                ...(continuation ? { continuation } : {}),
                _meta: { sourceTables: ["t_object", "t_attribute", "t_operation", "t_objectconstraint", "t_package"] },
            };
            return {
                content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
            };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error searching elements: ${msg}` }],
                isError: true,
            };
        }
    });
}
