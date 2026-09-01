import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { decodeEntities, foldText } from "../text.js";
import { breakdownApplies, buildBreakdown, buildContinuation, countBy, isTruncated, limitParam, offsetParam } from "./windowing.js";
import { getPackageSubtree, resolvePackageScope } from "../package-path.js";
const corpora = new WeakMap();
const MAX_INLINE_MATCHES = 3;
const SNIPPET_CHARS = 150;
const NOTE_PREVIEW_CHARS = 200;
function wordSpans(s) {
    const spans = [];
    const re = /\S+/g;
    for (let m = re.exec(s); m !== null; m = re.exec(s))
        spans.push([m.index, m.index + m[0].length]);
    return spans;
}
/**
 * No step in foldText creates or removes whitespace, so the k-th word of the folded text
 * is the k-th word of the original. That is what locates a match in the author's own text
 * without keeping an offset map between the two forms.
 */
function excerptAround(original, folded, foldedQuery, budget) {
    const at = folded.indexOf(foldedQuery);
    const foldedWords = wordSpans(folded);
    const words = wordSpans(original);
    // A word that folds away entirely would break the correspondence; fall back rather than misquote.
    if (at < 0 || foldedWords.length !== words.length || words.length === 0) {
        return { text: original.slice(0, budget), truncated: original.length > budget };
    }
    const end = at + foldedQuery.length;
    let lo = foldedWords.findIndex(([, e]) => e > at);
    if (lo < 0)
        lo = 0;
    let hi = lo;
    while (hi + 1 < foldedWords.length && foldedWords[hi + 1][0] < end)
        hi++;
    for (let grew = true; grew;) {
        grew = false;
        if (lo > 0 && words[hi][1] - words[lo - 1][0] <= budget) {
            lo--;
            grew = true;
        }
        if (hi + 1 < words.length && words[hi + 1][1] - words[lo][0] <= budget) {
            hi++;
            grew = true;
        }
    }
    const head = lo > 0 ? "…" : "";
    const tail = hi < words.length - 1 ? "…" : "";
    return { text: head + original.slice(words[lo][0], words[hi][1]) + tail, truncated: head !== "" || tail !== "" };
}
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
function selectIn(db, sql, ids) {
    if (ids.size === 0)
        return [];
    const list = [...ids];
    return db.prepare(`${sql} (${list.map(() => "?").join(",")})`).all(...list);
}
/** The author's own text behind a corpus entry, with the name of whatever carried it. */
function originalFor(entry, src) {
    const decoded = (raw, name) => typeof raw === "string" && raw.length > 0 ? { text: decodeEntities(raw), name } : null;
    if (entry.sourceTable === "t_object") {
        return decoded(src.rows.get(entry.objectId)?.[entry.sourceField], null);
    }
    if (entry.sourceTable === "t_attribute") {
        const a = src.attributes.get(entry.sourceId);
        return a ? decoded(entry.sourceField === "Name" ? a.Name : a.Notes, a.Name ?? null) : null;
    }
    if (entry.sourceTable === "t_operation") {
        const op = src.operations.get(entry.sourceId);
        return op ? decoded(entry.sourceField === "Name" ? op.Name : op.Notes, op.Name ?? null) : null;
    }
    if (entry.sourceTable === "t_objectconstraint") {
        // Constraint rows carry no identity of their own, so the right note is found by its folded form.
        const row = (src.constraints.get(entry.sourceId) ?? [])
            .find((c) => typeof c.Notes === "string" && foldText(decodeEntities(c.Notes)) === entry.foldedText);
        return row ? decoded(row.Notes, row.Constraint ?? null) : null;
    }
    return null;
}
/**
 * Why each windowed element matched. Scanning is confined to the window, so the cost is
 * bounded by what the response shows rather than by the corpus.
 */
function collectEvidence(db, entries, rows, windowIds, foldedQuery) {
    const hits = new Map();
    for (const entry of entries) {
        if (!windowIds.has(entry.objectId) || !entry.foldedText.includes(foldedQuery))
            continue;
        const list = hits.get(entry.objectId);
        if (list)
            list.push(entry);
        else
            hits.set(entry.objectId, [entry]);
    }
    const kept = new Map();
    for (const [objectId, list] of hits) {
        const ranked = list
            .map((e) => ({ e, ...scoreMatch(e, foldedQuery) }))
            .sort((a, b) => a.rank - b.rank || b.coverage - a.coverage || a.e.sourceId - b.e.sourceId)
            .slice(0, MAX_INLINE_MATCHES)
            .map((r) => r.e);
        kept.set(objectId, { entries: ranked, totalMatched: list.length });
    }
    const attributeIds = new Set();
    const operationIds = new Set();
    const constraintOwners = new Set();
    for (const { entries: shown } of kept.values()) {
        for (const e of shown) {
            if (e.sourceTable === "t_attribute")
                attributeIds.add(e.sourceId);
            else if (e.sourceTable === "t_operation")
                operationIds.add(e.sourceId);
            else if (e.sourceTable === "t_objectconstraint")
                constraintOwners.add(e.sourceId);
        }
    }
    const constraints = new Map();
    for (const c of selectIn(db, `SELECT Object_ID, "Constraint", Notes FROM t_objectconstraint WHERE Object_ID IN`, constraintOwners)) {
        const list = constraints.get(c.Object_ID);
        if (list)
            list.push(c);
        else
            constraints.set(c.Object_ID, [c]);
    }
    const src = {
        rows,
        attributes: new Map(selectIn(db, "SELECT ID, Name, Notes FROM t_attribute WHERE ID IN", attributeIds).map((a) => [a.ID, a])),
        operations: new Map(selectIn(db, "SELECT OperationID, Name, Notes FROM t_operation WHERE OperationID IN", operationIds).map((o) => [o.OperationID, o])),
        constraints,
    };
    const evidence = new Map();
    for (const [objectId, { entries: shown, totalMatched }] of kept) {
        const items = [];
        for (const entry of shown) {
            const original = originalFor(entry, src);
            if (!original)
                continue;
            const excerpt = excerptAround(original.text, entry.foldedText, foldedQuery, SNIPPET_CHARS);
            items.push({
                matchedIn: `${entry.sourceTable}.${entry.sourceField}`,
                sourceId: entry.sourceId,
                sourceName: original.name,
                snippet: excerpt.text,
                snippetTruncated: excerpt.truncated,
            });
        }
        evidence.set(objectId, { items, totalMatched });
    }
    return evidence;
}
export function configureSearchTools(server, model) {
    server.tool("ea_search", "Search Enterprise Architect model elements by name, alias, notes, attribute names/notes, operation names/notes, or constraint notes. Matching is case- and diacritic-insensitive across European Latin alphabets and sees through entity-encoded text. Matching elements are returned in `results`, strongest match first, each with a decoded note preview and a truncation flag; equally strong matches fall back to the model's internal identity, a stable but artificial order. Each result also carries `matches`, the evidence for why it was returned: the field that matched, the id and name of the attribute, operation or constraint it came from, and a snippet of the author's own text around the match. Evidence is strongest-first and capped, and `_meta.matches` on the result reports how many matches were found and how many were withheld. The note preview centres on the match when the element's own note is what matched. `packageScope` restricts results to a package (given as its id or its name) and its descendants. Walk a large result set with `offset` rather than a larger `limit`; while rows remain, `continuation` names the next call. When far more elements match than one window can hold, `breakdown` reports how they distribute — by `objectType`, `stereotype`, or, unless already scoped, by `packageScope` (reported as the matching package's id, which the next call can pass straight back) — so the next call can narrow instead of paging.", {
        query: z.string().describe("Search term to find across all model text (names, notes, aliases, attributes, operations, constraints)"),
        objectType: z
            .string()
            .optional()
            .describe("Filter by object type (e.g., Class, UseCase, Activity, Screen, Requirement, Interface, Component)"),
        stereotype: z.string().optional().describe("Filter by stereotype"),
        packageScope: z
            .union([z.number().int(), z.string()])
            .optional()
            .describe("Restrict results to this package and its descendants, given as a package id or name"),
        limit: limitParam(25),
        offset: offsetParam,
    }, READ_ONLY, async ({ query, objectType, stereotype, packageScope, limit, offset }) => {
        const db = await model.database();
        try {
            let subtree;
            if (packageScope !== undefined) {
                const resolution = resolvePackageScope(db, packageScope);
                if (resolution.kind === "not_found") {
                    return {
                        content: [{ type: "text", text: JSON.stringify({
                                    error: "not_found",
                                    message: `Package scope "${packageScope}" was not found.`,
                                    packageScope,
                                }, null, 2) }],
                        isError: true,
                    };
                }
                if (resolution.kind === "ambiguous") {
                    return {
                        content: [{ type: "text", text: JSON.stringify({
                                    error: "ambiguous_package",
                                    message: `Package scope "${packageScope}" matches more than one package; use a package id instead.`,
                                    candidates: resolution.candidates,
                                }, null, 2) }],
                        isError: true,
                    };
                }
                subtree = getPackageSubtree(db, resolution.packageId);
            }
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
            // Package_ID is on every fetched row, so scoping is a subtree membership check, not a query change.
            const scopedRows = subtree ? allRows.filter((r) => subtree.has(r.Package_ID)) : allRows;
            // IN (...) returns rows in whatever order the plan produces, so rank order is restored here.
            const rowMap = new Map(scopedRows.map((r) => [r.Object_ID, r]));
            const totalMatched = sortedIds.filter((id) => rowMap.has(id)).length;
            const sorted = sortedIds
                .filter((id) => rowMap.has(id))
                .map((id) => rowMap.get(id));
            const window = sorted.slice(offset, offset + limit);
            const truncated = isTruncated(offset, window.length, totalMatched);
            const evidence = collectEvidence(db, entries, rowMap, new Set(window.map((r) => r.Object_ID)), foldedQuery);
            const results = window.map((r) => {
                const decodedNote = decodeEntities(r.Note);
                const matchedIn = matchMap.get(r.Object_ID)?.matchedIn ?? null;
                // Previewing from the start hides the reason for a match that lies deeper in the note.
                const notePreview = !decodedNote
                    ? null
                    : matchedIn === "t_object.Note"
                        ? excerptAround(decodedNote, foldText(decodedNote), foldedQuery, NOTE_PREVIEW_CHARS).text
                        : decodedNote.slice(0, NOTE_PREVIEW_CHARS);
                const notePreviewTruncated = decodedNote != null && decodedNote.length > NOTE_PREVIEW_CHARS;
                const matches = evidence.get(r.Object_ID);
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
                    matchedIn,
                    matches: matches?.items ?? [],
                    _meta: {
                        matches: {
                            totalMatched: matches?.totalMatched ?? 0,
                            returned: matches?.items.length ?? 0,
                            truncated: (matches?.totalMatched ?? 0) > (matches?.items.length ?? 0),
                        },
                    },
                };
            });
            const breakdown = breakdownApplies(totalMatched, limit)
                ? buildBreakdown({
                    objectType: objectType ? undefined : countBy(sorted, (r) => r.Object_Type),
                    stereotype: stereotype ? undefined : countBy(sorted, (r) => r.Stereotype),
                    packageScope: packageScope !== undefined ? undefined : countBy(sorted, (r) => r.Package_ID),
                })
                : undefined;
            const continuation = buildContinuation("ea_search", { query, objectType, stereotype, packageScope, limit }, offset, results.length, totalMatched);
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
