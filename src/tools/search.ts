import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "../database.js";
import type { ModelAccess } from "../model-session.js";
import { READ_ONLY } from "./annotations.js";
import type { SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { decodeEntities, foldText } from "../text.js";

interface CorpusEntry {
  sourceTable: string;
  sourceId: number;
  sourceField: string;
  objectId: number;
  foldedText: string;
}

const corpora = new WeakMap<Database, CorpusEntry[]>();

function buildCorpus(db: Database): CorpusEntry[] {
  const cached = corpora.get(db);
  if (cached) return cached;

  const entries: CorpusEntry[] = [];

  // t_object: Name, Alias, Note
  const objects = db.prepare("SELECT Object_ID, Name, Alias, Note FROM t_object").all() as any[];
  for (const o of objects) {
    if (o.Name) entries.push({ sourceTable: "t_object", sourceId: o.Object_ID, sourceField: "Name", objectId: o.Object_ID, foldedText: foldText(decodeEntities(o.Name)!) });
    if (o.Alias) entries.push({ sourceTable: "t_object", sourceId: o.Object_ID, sourceField: "Alias", objectId: o.Object_ID, foldedText: foldText(decodeEntities(o.Alias)!) });
    if (o.Note) entries.push({ sourceTable: "t_object", sourceId: o.Object_ID, sourceField: "Note", objectId: o.Object_ID, foldedText: foldText(decodeEntities(o.Note)!) });
  }

  // t_attribute: Name, Notes
  const attrs = db.prepare("SELECT ID, Object_ID, Name, Notes FROM t_attribute").all() as any[];
  for (const a of attrs) {
    if (a.Name) entries.push({ sourceTable: "t_attribute", sourceId: a.ID, sourceField: "Name", objectId: a.Object_ID, foldedText: foldText(decodeEntities(a.Name)!) });
    if (a.Notes) entries.push({ sourceTable: "t_attribute", sourceId: a.ID, sourceField: "Notes", objectId: a.Object_ID, foldedText: foldText(decodeEntities(a.Notes)!) });
  }

  // t_operation: Name, Notes
  const ops = db.prepare("SELECT OperationID, Object_ID, Name, Notes FROM t_operation").all() as any[];
  for (const op of ops) {
    if (op.Name) entries.push({ sourceTable: "t_operation", sourceId: op.OperationID, sourceField: "Name", objectId: op.Object_ID, foldedText: foldText(decodeEntities(op.Name)!) });
    if (op.Notes) entries.push({ sourceTable: "t_operation", sourceId: op.OperationID, sourceField: "Notes", objectId: op.Object_ID, foldedText: foldText(decodeEntities(op.Notes)!) });
  }

  // t_objectconstraint: Notes
  const constraints = db.prepare(`SELECT Object_ID, Notes FROM t_objectconstraint WHERE Notes IS NOT NULL AND Notes != ''`).all() as any[];
  for (const c of constraints) {
    entries.push({ sourceTable: "t_objectconstraint", sourceId: c.Object_ID, sourceField: "Notes", objectId: c.Object_ID, foldedText: foldText(decodeEntities(c.Notes)!) });
  }

  corpora.set(db, entries);
  return entries;
}

export function configureSearchTools(server: McpServer, model: ModelAccess): void {
  server.tool(
    "ea_search",
    "Search Enterprise Architect model elements by name, alias, notes, attribute names/notes, operation names/notes, or constraint notes. Matching is case- and diacritic-insensitive across European Latin alphabets and sees through entity-encoded text. Matching elements are returned in `results`, each with a decoded note preview and a truncation flag.",
    {
      query: z.string().describe("Search term to find across all model text (names, notes, aliases, attributes, operations, constraints)"),
      objectType: z
        .string()
        .optional()
        .describe("Filter by object type (e.g., Class, UseCase, Activity, Screen, Requirement, Interface, Component)"),
      stereotype: z.string().optional().describe("Filter by stereotype"),
      limit: z.coerce.number().default(25).describe("Maximum number of results to return (default 25)"),
    },
    READ_ONLY,
    async ({ query, objectType, stereotype, limit }) => {
      const db = await model.database();
      try {
        const entries = buildCorpus(db);
        const foldedQuery = foldText(query).trim();

        if (foldedQuery.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              results: [],
              totalMatched: 0,
              returned: 0,
              truncated: false,
              _meta: { sourceTables: ["t_object", "t_attribute", "t_operation", "t_objectconstraint", "t_package"] },
              error: "Query is empty after normalization.",
            }, null, 2) }],
          };
        }

        // Find matching object IDs with match quality ranking
        const matchMap = new Map<number, { rank: number; matchedIn: string }>();

        for (const entry of entries) {
          if (!entry.foldedText.includes(foldedQuery)) continue;

          const existing = matchMap.get(entry.objectId);
          let rank: number;
          if (entry.sourceTable === "t_object" && entry.sourceField === "Name") {
            rank = entry.foldedText === foldedQuery ? 0 : 1; // exact name vs substring
          } else if (entry.sourceTable === "t_object" && entry.sourceField === "Alias") {
            rank = 2;
          } else if (entry.sourceTable === "t_object" && entry.sourceField === "Note") {
            rank = 3;
          } else {
            rank = 4; // attribute, operation, constraint matches
          }

          if (!existing || rank < existing.rank) {
            matchMap.set(entry.objectId, { rank, matchedIn: `${entry.sourceTable}.${entry.sourceField}` });
          }
        }

        if (matchMap.size === 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                results: [],
                totalMatched: 0,
                returned: 0,
                truncated: false,
                _meta: { sourceTables: ["t_object", "t_attribute", "t_operation", "t_objectconstraint", "t_package"] },
              }, null, 2),
            }],
          };
        }

        // Sort by rank, then fetch element details from DB for top matches
        const sortedIds = [...matchMap.entries()]
          .sort((a, b) => a[1].rank - b[1].rank)
          .map(([id]) => id);

        // Build SQL to fetch matched elements with filters
        let filterClauses = "";
        const filterParams: SQLInputValue[] = [];
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
        const allRows = db.prepare(sql).all(...sortedIds, ...filterParams) as any[];

        // IN (...) returns rows in whatever order the plan produces, so rank order is restored here.
        const rowMap = new Map(allRows.map((r: any) => [r.Object_ID, r]));
        const totalMatched = sortedIds.filter((id) => rowMap.has(id)).length;
        const sorted = sortedIds
          .filter((id) => rowMap.has(id))
          .map((id) => rowMap.get(id)!);

        const truncated = sorted.length > limit;
        const results = sorted.slice(0, limit).map((r: any) => {
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

        const response: any = {
          results,
          totalMatched,
          returned: results.length,
          truncated,
          _meta: { sourceTables: ["t_object", "t_attribute", "t_operation", "t_objectconstraint", "t_package"] },
        };

        if (truncated) {
          response.continuation = {
            tool: "ea_search",
            arguments: { query, objectType, stereotype, limit: Math.max(limit * 2, totalMatched) },
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error searching elements: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
