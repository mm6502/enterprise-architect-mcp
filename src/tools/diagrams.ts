import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "../database.js";
import type { ModelAccess } from "../model-session.js";
import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { decodeEntities, foldText } from "../text.js";
import { buildPackagePath } from "../package-path.js";

// Reuse feature link parsing from connectors — import the module's export
// Since the feature link logic is internal to connectors, we inline a lightweight version here
const FEATURE_LINK_RE = /LF([SE])P=\{([^}]+)\}[^;]*/g;

function resolveFeatureGuid(db: Database, guid: string) {
  const attr = db
    .prepare(
      `SELECT a.Name, a.Notes, o.Name as ElementName
       FROM t_attribute a LEFT JOIN t_object o ON a.Object_ID = o.Object_ID
       WHERE a.ea_guid = ? COLLATE NOCASE`
    )
    .get(guid) as { Name: string; Notes: string | null; ElementName: string | null } | undefined;
  if (attr) {
    return { resolved: true, name: attr.Name, owningElementName: attr.ElementName, notes: decodeEntities(attr.Notes), type: "attribute" as const };
  }

  const op = db
    .prepare(
      `SELECT p.Name, p.Notes, o.Name as ElementName
       FROM t_operation p LEFT JOIN t_object o ON p.Object_ID = o.Object_ID
       WHERE p.ea_guid = ? COLLATE NOCASE`
    )
    .get(guid) as { Name: string; Notes: string | null; ElementName: string | null } | undefined;
  if (op) {
    return { resolved: true, name: op.Name, owningElementName: op.ElementName, notes: decodeEntities(op.Notes), type: "operation" as const };
  }

  return { resolved: false, present: true, guid };
}

function parseFeatureLinks(db: Database, styleEx: string | null) {
  if (!styleEx) return { sourceFeature: null, targetFeature: null };
  let sourceFeature: any = null;
  let targetFeature: any = null;
  let m: RegExpExecArray | null;
  FEATURE_LINK_RE.lastIndex = 0;
  while ((m = FEATURE_LINK_RE.exec(styleEx)) !== null) {
    const side = m[1];
    const guid = `{${m[2]}}`;
    const feature = resolveFeatureGuid(db, guid);
    if (side === "S") sourceFeature = feature;
    else targetFeature = feature;
  }
  return { sourceFeature, targetFeature };
}

export function configureDiagramTools(server: McpServer, model: ModelAccess): void {
  server.tool(
    "ea_get_diagram_elements",
    "Get all elements and connectors placed on a specific diagram: the `diagram` itself, plus `elements` and `connectors`. Connectors include feature-link resolution showing which attribute or operation each end attaches to. The connector list is the union of explicit t_diagramlinks rows and implied connectors (both ends on the diagram).",
    {
      diagramId: z.coerce.number().describe("The Diagram_ID to get elements for"),
    },
    READ_ONLY,
    async ({ diagramId }) => {
      const db = await model.database();
      try {
        const diagram = db.prepare(`
          SELECT d.Diagram_ID, d.Name, d.Diagram_Type, d.Package_ID, d.Notes,
                 p.Name as PackageName
          FROM t_diagram d
          LEFT JOIN t_package p ON d.Package_ID = p.Package_ID
          WHERE d.Diagram_ID = ?
        `).get(diagramId) as any;

        if (!diagram) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", message: `Diagram with ID ${diagramId} not found`, diagramId }, null, 2) }],
            isError: true,
          };
        }

        const elements = db.prepare(`
          SELECT o.Object_ID, o.Object_Type, o.Name, o.Alias, o.Stereotype, o.Note
          FROM t_diagramobjects do_
          JOIN t_object o ON do_.Object_ID = o.Object_ID
          WHERE do_.Diagram_ID = ?
          ORDER BY do_.Sequence
        `).all(diagramId) as any[];

        const elementResults = elements.map((e: any) => {
          const result: any = { Object_ID: e.Object_ID, Object_Type: e.Object_Type, Name: e.Name, Alias: e.Alias, Stereotype: e.Stereotype };
          if (e.Object_Type === "Note") result.Note = decodeEntities(e.Note);
          return result;
        });

        // R2: Connectors on diagram — union of explicit links and implied connectors
        // Explicit: rows in t_diagramlinks for this diagram
        // Implied: connectors whose both Start_Object_ID and End_Object_ID appear in t_diagramobjects for this diagram
        const connectorRows = db.prepare(`
          SELECT DISTINCT c.Connector_ID, c.Connector_Type, c.SubType, c.Name, c.Direction,
                 c.Stereotype, c.Notes, c.SourceCard, c.DestCard,
                 c.Start_Object_ID, c.End_Object_ID,
                 c.SourceRole, c.DestRole, c.StyleEx,
                 src.Name as SourceName, src.Object_Type as SourceType,
                 dst.Name as DestName, dst.Object_Type as DestType,
                 dl.Hidden
          FROM t_connector c
          LEFT JOIN t_object src ON c.Start_Object_ID = src.Object_ID
          LEFT JOIN t_object dst ON c.End_Object_ID = dst.Object_ID
          LEFT JOIN t_diagramlinks dl ON dl.ConnectorID = c.Connector_ID AND dl.DiagramID = ?
          WHERE
            dl.ConnectorID IS NOT NULL
            OR (
              c.Start_Object_ID IN (SELECT Object_ID FROM t_diagramobjects WHERE Diagram_ID = ?)
              AND c.End_Object_ID IN (SELECT Object_ID FROM t_diagramobjects WHERE Diagram_ID = ?)
            )
        `).all(diagramId, diagramId, diagramId) as any[];

        const connectors = connectorRows.map((r: any) => {
          const { sourceFeature, targetFeature } = parseFeatureLinks(db, r.StyleEx);
          return {
            id: r.Connector_ID,
            type: r.Connector_Type,
            subType: r.SubType,
            name: r.Name,
            stereotype: r.Stereotype,
            notes: decodeEntities(r.Notes),
            sourceCard: r.SourceCard,
            destCard: r.DestCard,
            sourceRole: r.SourceRole || null,
            destRole: r.DestRole || null,
            hidden: r.Hidden === 1,
            source: { id: r.Start_Object_ID, name: r.SourceName, type: r.SourceType },
            dest: { id: r.End_Object_ID, name: r.DestName, type: r.DestType },
            sourceFeature,
            targetFeature,
          };
        });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              diagram: {
                id: diagram.Diagram_ID,
                name: diagram.Name,
                type: diagram.Diagram_Type,
                packageId: diagram.Package_ID,
                packageName: diagram.PackageName,
                notes: decodeEntities(diagram.Notes),
              },
              elements: elementResults,
              connectors,
              _meta: {
                sourceTables: ["t_diagram", "t_package", "t_diagramobjects", "t_object", "t_connector", "t_diagramlinks", "t_attribute", "t_operation"],
                elements: { totalMatched: elementResults.length, returned: elementResults.length, truncated: false },
                connectors: { totalMatched: connectors.length, returned: connectors.length, truncated: false },
              },
            }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error retrieving diagram elements: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // R7: List and search diagrams
  server.tool(
    "ea_list_diagrams",
    "List diagrams in the model, optionally filtered by package and/or name substring. Each entry in `results` carries `diagramId`, `name`, `type`, `packagePath`, and `eaGuid`.",
    {
      packageId: z.coerce.number().optional().describe("Filter to diagrams in this package"),
      nameContains: z.string().optional().describe("Filter to diagrams whose name contains this substring (case-insensitive across Slovak alphabet)"),
      limit: z.coerce.number().default(50).describe("Maximum number of results (default 50)"),
    },
    READ_ONLY,
    async ({ packageId, nameContains, limit }) => {
      const db = await model.database();
      try {
        if (packageId != null) {
          const pkgExists = db.prepare("SELECT Package_ID FROM t_package WHERE Package_ID = ?").get(packageId);
          if (!pkgExists) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", message: `Package with ID ${packageId} not found`, packageId }, null, 2) }],
              isError: true,
            };
          }
        }

        let sql = "SELECT Diagram_ID, Name, Diagram_Type, Package_ID, ea_guid FROM t_diagram WHERE 1=1";
        const params: any[] = [];

        if (packageId != null) {
          sql += " AND Package_ID = ?";
          params.push(packageId);
        }

        const allRows = db.prepare(sql).all(...params) as any[];

        let filtered = allRows;
        if (nameContains) {
          const folded = foldText(nameContains);
          filtered = allRows.filter((r: any) => foldText(r.Name || "").includes(folded));
        }

        const totalMatched = filtered.length;
        const truncated = filtered.length > limit;
        const results = filtered.slice(0, limit).map((r: any) => ({
          diagramId: r.Diagram_ID,
          name: r.Name,
          type: r.Diagram_Type,
          packagePath: buildPackagePath(db, r.Package_ID),
          eaGuid: r.ea_guid,
        }));

        const response: any = { results, totalMatched, returned: results.length, truncated, _meta: { sourceTables: ["t_diagram", "t_package"] } };
        if (truncated) {
          response.continuation = {
            tool: "ea_list_diagrams",
            arguments: { packageId, nameContains, limit: Math.max(limit * 2, totalMatched) },
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error listing diagrams: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
