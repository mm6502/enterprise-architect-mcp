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
/**
 * True when the query begins somewhere other than mid-word — including at the very start of
 * the text. Single-term ranking never reaches this for a position-0 match (rank 1, `startsWith`,
 * already wins first), so widening it to treat idx 0 as a boundary is safe there; it matters
 * once several terms are checked independently (R7), where an earlier term's own position-0
 * match must not be misread as failing the boundary test.
 */
function startsAtWordBoundary(text, query) {
    for (let idx = text.indexOf(query); idx >= 0; idx = text.indexOf(query, idx + 1)) {
        if (idx === 0 || !/[\p{L}\p{N}]/u.test(text[idx - 1]))
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
/** Below every single-field ladder rank (0-10), so R1's cross-field match never outranks one. */
const SPREAD_RANK = 11;
/**
 * Whether every supplied term occurs in `text`, each immediately after the previous one save
 * for a run of non-alphanumeric characters — i.e. adjacent in the caller's own order (R8).
 * Meaningless for a single term (there is nothing to be adjacent to), so it is always false
 * then, which is what keeps this out of the single-term path entirely.
 */
function isPhraseGrade(text, foldedTerms) {
    if (foldedTerms.length < 2)
        return false;
    const escaped = foldedTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(escaped.join("[^\\p{L}\\p{N}]*"), "u").test(text);
}
/**
 * How far apart several required terms sit in the text that carried all of them — the smallest
 * span containing at least one occurrence of every term. Smaller is more proximate (R10). Always
 * 0 for a single term, so it never perturbs the single-term freeze (R3): every candidate ties
 * at 0 and the comparison falls straight through to the next tiebreak, exactly as it does today.
 * A term repeated elsewhere in the text must not make a genuinely tight cluster look far apart,
 * so every occurrence of every term is a candidate, not just each term's first (the classic
 * "smallest range covering every list" problem: merge all occurrences by position, then slide a
 * window until it covers every term, shrinking from the left while it still does).
 */
function termProximity(text, foldedTerms) {
    if (foldedTerms.length < 2)
        return 0;
    const occurrences = [];
    foldedTerms.forEach((t, term) => {
        for (let at = text.indexOf(t); at >= 0; at = text.indexOf(t, at + 1)) {
            occurrences.push({ pos: at, term });
        }
    });
    if (occurrences.length === 0)
        return 0;
    occurrences.sort((a, b) => a.pos - b.pos);
    const counts = new Array(foldedTerms.length).fill(0);
    let distinct = 0;
    let left = 0;
    let best = Infinity;
    for (let right = 0; right < occurrences.length; right++) {
        if (counts[occurrences[right].term]++ === 0)
            distinct++;
        while (distinct === foldedTerms.length) {
            best = Math.min(best, occurrences[right].pos - occurrences[left].pos);
            if (--counts[occurrences[left].term] === 0)
                distinct--;
            left++;
        }
    }
    return best === Infinity ? 0 : best;
}
/**
 * Generalises scoreMatch to several required terms, reducing exactly to it for one term —
 * that identity is what lets R3's freeze hold by construction rather than by a parallel code
 * path. Exact and prefix (ranks 0-1) stay single-term concepts: neither has a natural meaning
 * once more than one distinct required term is involved. Word-boundary (rank 2) generalises
 * cleanly instead (R7): it holds only when every term independently starts at a boundary,
 * otherwise the match settles at the ladder's infix rank (3). Every other bucket depends only
 * on (sourceTable, sourceField), so it is unaffected by term count. A phrase-grade match (R8)
 * then promotes half a rank within whichever bucket it already landed in — never crossing into
 * a neighbouring field's territory, which is what keeps R9's resolvable-to-one-field guarantee
 * intact. Coverage becomes the summed term length over the text length, capped at 1 — how this
 * should really work for a multi-term match is an open question (see Outstanding Questions),
 * and this is a placeholder, not a final answer.
 */
function scoreMultiMatch(entry, foldedTerms) {
    if (foldedTerms.length === 1)
        return { ...scoreMatch(entry, foldedTerms[0]), proximity: 0 };
    const text = entry.foldedText;
    const coverage = text.length > 0
        ? Math.min(1, foldedTerms.reduce((sum, t) => sum + t.length, 0) / text.length)
        : 0;
    let rank;
    if (entry.sourceTable === "t_object" && entry.sourceField === "Name") {
        rank = foldedTerms.every((t) => startsAtWordBoundary(text, t)) ? 2 : 3;
    }
    else {
        rank = scoreMatch(entry, foldedTerms[0]).rank;
    }
    if (isPhraseGrade(text, foldedTerms))
        rank -= 0.5;
    return { rank, coverage, proximity: termProximity(text, foldedTerms) };
}
/**
 * Whether every required term occurs somewhere in this object's searchable text (R1), and how
 * it ranks. A single entry carrying every term ranks via the existing ladder (R7); an object
 * whose terms are only found spread across separate entries still matches, but ranks below
 * every single-field tier — R1's "ranking preference, not a condition of matching". Reduces
 * to today's single-term matching and ranking exactly when only one term is supplied, since
 * every entry containing that one term trivially "carries every term", and proximity is always
 * 0 for one term (see termProximity), so the R10/R11 tiebreak this adds is a no-op there too.
 */
function matchObject(objEntries, foldedTerms) {
    for (const term of foldedTerms) {
        if (!objEntries.some((e) => e.foldedText.includes(term)))
            return null;
    }
    let best;
    for (const e of objEntries) {
        if (!foldedTerms.every((t) => e.foldedText.includes(t)))
            continue;
        const { rank, coverage, proximity } = scoreMultiMatch(e, foldedTerms);
        const better = !best ||
            rank < best.rank ||
            (rank === best.rank && coverage > best.coverage) ||
            (rank === best.rank && coverage === best.coverage && proximity < best.proximity);
        if (better) {
            best = { rank, coverage, proximity, matchedIn: `${e.sourceTable}.${e.sourceField}` };
        }
    }
    if (best)
        return best;
    // Spread: no single entry carries every term. Coverage is the average of each term's own
    // best-entry coverage — like the rank placeholder above, an interim answer, not a final one.
    // Proximity has no shared text to measure across separate entries, so it stays neutral (0).
    let coverageSum = 0;
    for (const term of foldedTerms) {
        let bestCoverage = 0;
        for (const e of objEntries) {
            if (!e.foldedText.includes(term))
                continue;
            const { coverage } = scoreMatch(e, term);
            if (coverage > bestCoverage)
                bestCoverage = coverage;
        }
        coverageSum += bestCoverage;
    }
    return { rank: SPREAD_RANK, coverage: coverageSum / foldedTerms.length, proximity: 0, matchedIn: null };
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
 * bounded by what the response shows rather than by the corpus. Matches an entry against any
 * of the required terms (not all of them, unlike matchObject) since evidence is about what
 * each field contributed, and reduces to single-term behaviour exactly when only one is given.
 */
function collectEvidence(db, entries, rows, windowIds, foldedTerms) {
    const hits = new Map();
    for (const entry of entries) {
        if (!windowIds.has(entry.objectId) || !foldedTerms.some((t) => entry.foldedText.includes(t)))
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
            .map((e) => {
            const present = foldedTerms.filter((t) => e.foldedText.includes(t));
            return { e, present, ...scoreMultiMatch(e, present) };
        })
            .sort((a, b) => a.rank - b.rank || b.coverage - a.coverage || a.proximity - b.proximity || a.e.sourceId - b.e.sourceId)
            .slice(0, MAX_INLINE_MATCHES)
            .map((r) => ({ entry: r.e, term: r.present[0] }));
        kept.set(objectId, { entries: ranked, totalMatched: list.length });
    }
    const attributeIds = new Set();
    const operationIds = new Set();
    const constraintOwners = new Set();
    for (const { entries: shown } of kept.values()) {
        for (const { entry: e } of shown) {
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
        for (const { entry, term } of shown) {
            const original = originalFor(entry, src);
            if (!original)
                continue;
            const excerpt = excerptAround(original.text, entry.foldedText, term, SNIPPET_CHARS);
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
const REQUIRED_TERMS_PARAM = z
    .array(z.string())
    .min(1)
    .max(10)
    .describe("Terms every one of which must occur somewhere in the element's searchable text (names, notes, aliases, attributes, operations, constraints); terms need not share a field; capped at 10");
const OBJECT_TYPE_PARAM = z
    .string()
    .optional()
    .describe("Filter by object type (e.g., Class, UseCase, Activity, Screen, Requirement, Interface, Component)");
const STEREOTYPE_PARAM = z.string().optional().describe("Filter by stereotype");
const PACKAGE_SCOPE_PARAM = z
    .union([z.number().int(), z.string()])
    .optional()
    .describe("Restrict results to this package and its descendants, given as a package id or name");
/**
 * Shared by both tools: `ea_search`'s required-term matching, ranking and response shape are
 * identical either way. Only what an alternatives match does differs — boost promotes a tier
 * within the same rank without excluding anything, filter removes an object lacking any
 * alternative entirely — so that is the one thing this takes as a parameter.
 */
async function runSearch(db, toolName, altParamName, altMode, args, alternatives) {
    const { requiredTerms, objectType, stereotype, packageScope, limit, offset } = args;
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
        const normalizedTerms = requiredTerms.map((t) => foldText(t).trim());
        if (normalizedTerms.some((t) => t.length === 0)) {
            return {
                content: [{ type: "text", text: JSON.stringify({
                            results: [],
                            totalMatched: 0,
                            returned: 0,
                            offset,
                            truncated: false,
                            _meta: { sourceTables: ["t_object", "t_attribute", "t_operation", "t_objectconstraint", "t_package"] },
                            error: "At least one requiredTerms entry is empty after normalization (whitespace-only or blank).",
                        }, null, 2) }],
            };
        }
        // Duplicate terms would otherwise double-count coverage and cross the phrase-grade check
        // against itself; a caller-supplied duplicate is a no-op, not a stronger requirement.
        const foldedTerms = [...new Set(normalizedTerms)];
        // Group once so a term found via one entry and another via a different entry of the
        // same object still counts as a match (R1): terms need not share a field.
        const byObject = new Map();
        for (const entry of entries) {
            const list = byObject.get(entry.objectId);
            if (list)
                list.push(entry);
            else
                byObject.set(entry.objectId, [entry]);
        }
        const matchMap = new Map();
        for (const [objectId, objEntries] of byObject) {
            const match = matchObject(objEntries, foldedTerms);
            if (match)
                matchMap.set(objectId, { ...match, boosted: false });
        }
        if (matchMap.size === 0) {
            // R6: a caller guessing at stems cannot tell which one emptied the result without
            // this — report each supplied term's own corpus-wide presence, independent of the
            // others, rather than leaving them to re-guess the whole call.
            const termMatches = requiredTerms.map((term) => {
                const folded = foldText(term).trim();
                return { term, matchedAnywhere: folded.length > 0 && entries.some((e) => e.foldedText.includes(folded)) };
            });
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            results: [],
                            totalMatched: 0,
                            returned: 0,
                            offset,
                            truncated: false,
                            termMatches,
                            _meta: { sourceTables: ["t_object", "t_attribute", "t_operation", "t_objectconstraint", "t_package"] },
                        }, null, 2),
                    }],
            };
        }
        // R4: the alternatives list is never required, and an empty one behaves as if omitted.
        const foldedAlt = alternatives.map((t) => foldText(t).trim()).filter((t) => t.length > 0);
        if (foldedAlt.length > 0) {
            for (const [objectId, match] of matchMap) {
                const objEntries = byObject.get(objectId);
                const satisfied = objEntries.some((e) => foldedAlt.some((a) => e.foldedText.includes(a)));
                if (altMode === "filter" && !satisfied)
                    matchMap.delete(objectId);
                else if (altMode === "boost" && satisfied)
                    match.boosted = true;
            }
        }
        if (matchMap.size === 0) {
            // Filtering removed every required-term match; this is not R6's case (the required
            // terms did match something), so no termMatches — just the plain empty shape.
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
        // Strongest first, then identity: without the final tiebreak, paging a large tie could
        // show the same row twice and never show another. `boosted` (R4's promotion) sits right
        // after rank — ahead of coverage — since it is a within-rank preference, not a new tier;
        // proximity (R10) then sits between coverage and identity, per R11. Both are no-ops when
        // there is nothing to distinguish (a single required term, or no alternatives supplied).
        const sortedIds = [...matchMap.entries()]
            .sort((a, b) => a[1].rank - b[1].rank ||
            Number(b[1].boosted) - Number(a[1].boosted) ||
            b[1].coverage - a[1].coverage ||
            a[1].proximity - b[1].proximity ||
            a[0] - b[0])
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
        const evidence = collectEvidence(db, entries, rowMap, new Set(window.map((r) => r.Object_ID)), foldedTerms);
        const results = window.map((r) => {
            const decodedNote = decodeEntities(r.Note);
            const matchedIn = matchMap.get(r.Object_ID)?.matchedIn ?? null;
            // Previewing from the start hides the reason for a match that lies deeper in the note.
            // matchedIn is only "t_object.Note" when the note itself carried every required term
            // (matchObject's single-field branch), so centring on the first term is always valid here.
            const notePreview = !decodedNote
                ? null
                : matchedIn === "t_object.Note"
                    ? excerptAround(decodedNote, foldText(decodedNote), foldedTerms[0], NOTE_PREVIEW_CHARS).text
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
        const continuation = buildContinuation(toolName, { requiredTerms, objectType, stereotype, packageScope, limit, [altParamName]: alternatives.length > 0 ? alternatives : undefined }, offset, results.length, totalMatched);
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
}
export function configureSearchTools(server, model) {
    server.tool("ea_search", "Search Enterprise Architect model elements by name, alias, notes, attribute names/notes, operation names/notes, or constraint notes. Matching is case- and diacritic-insensitive across European Latin alphabets and sees through entity-encoded text. `requiredTerms` is a list of terms every one of which must occur somewhere in an element's searchable text (conjunction) — terms need not share a field, but sharing one ranks higher; each term is matched as a contiguous substring exactly as a single term is, so a term carrying whitespace is a phrase and is never split. A one-entry list behaves exactly as a single search term always has. `boostAnyOf` is an optional list of further terms: a result also matching at least one of them ranks ahead of one that does not, but nothing is ever excluded on that basis — for narrowing to only elements matching an alternative too, use `ea_search_and_any_of` instead. When no element matches, `termMatches` reports, per supplied term, whether that term matched anywhere in the corpus at all — so a caller can tell which term emptied the result rather than re-guessing the whole call. Matching elements are returned in `results`, strongest match first, each with a decoded note preview and a truncation flag; equally strong matches fall back to the model's internal identity, a stable but artificial order. Each result also carries `matches`, the evidence for why it was returned: the field that matched, the id and name of the attribute, operation or constraint it came from, and a snippet of the author's own text around the match. Evidence is strongest-first and capped, and `_meta.matches` on the result reports how many matches were found and how many were withheld. The note preview centres on the match when the element's own note is what matched. `packageScope` restricts results to a package (given as its id or its name) and its descendants. Walk a large result set with `offset` rather than a larger `limit`; while rows remain, `continuation` names the next call. When far more elements match than one window can hold, `breakdown` reports how they distribute — by `objectType`, `stereotype`, or, unless already scoped, by `packageScope` (reported as the matching package's id, which the next call can pass straight back) — so the next call can narrow instead of paging.", {
        requiredTerms: REQUIRED_TERMS_PARAM,
        boostAnyOf: z
            .array(z.string())
            .max(10)
            .optional()
            .describe("Terms that promote a result's rank when also present; never excludes. Use ea_search_and_any_of to narrow instead."),
        objectType: OBJECT_TYPE_PARAM,
        stereotype: STEREOTYPE_PARAM,
        packageScope: PACKAGE_SCOPE_PARAM,
        limit: limitParam(25),
        offset: offsetParam,
    }, READ_ONLY, async ({ requiredTerms, boostAnyOf, objectType, stereotype, packageScope, limit, offset }) => {
        const db = await model.database();
        return runSearch(db, "ea_search", "boostAnyOf", "boost", { requiredTerms, objectType, stereotype, packageScope, limit, offset }, boostAnyOf ?? []);
    });
    server.tool("ea_search_and_any_of", "Search Enterprise Architect model elements the same way `ea_search` does, plus `andAnyOf`: a required-and-alternative filter. `requiredTerms` still works exactly as it does on `ea_search` (conjunction, contiguous substring, terms need not share a field). `andAnyOf` is an optional list of further terms; when supplied, a result must contain `requiredTerms` AND at least one `andAnyOf` term, so it can only ever narrow — it never returns a result `requiredTerms` alone would not. An empty `andAnyOf` array applies no filter. For promoting rather than narrowing, use `ea_search` instead, which offers the same alternatives idea as a rank boost. When no element matches the required terms at all, `termMatches` reports, per supplied term, whether it matched anywhere in the corpus. Matching elements are returned in `results`, strongest first, each with a decoded note preview, a truncation flag, and `matches` — the evidence for why it was returned, capped and strongest-first, with `_meta.matches` reporting how many were found and withheld. `packageScope` restricts results to a package and its descendants. Walk a large result set with `offset`; while rows remain, `continuation` names the next call. When far more elements match than one window can hold, `breakdown` reports how they distribute by `objectType`, `stereotype`, or `packageScope`.", {
        requiredTerms: REQUIRED_TERMS_PARAM,
        andAnyOf: z
            .array(z.string())
            .max(10)
            .optional()
            .describe("Terms a result must also contain at least one of, in addition to requiredTerms; never adds results. Use ea_search's boostAnyOf to only reorder instead."),
        objectType: OBJECT_TYPE_PARAM,
        stereotype: STEREOTYPE_PARAM,
        packageScope: PACKAGE_SCOPE_PARAM,
        limit: limitParam(25),
        offset: offsetParam,
    }, READ_ONLY, async ({ requiredTerms, andAnyOf, objectType, stereotype, packageScope, limit, offset }) => {
        const db = await model.database();
        return runSearch(db, "ea_search_and_any_of", "andAnyOf", "filter", { requiredTerms, objectType, stereotype, packageScope, limit, offset }, andAnyOf ?? []);
    });
}
