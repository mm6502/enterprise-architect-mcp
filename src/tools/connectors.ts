import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "../database.js";
import type { ModelAccess } from "../model-session.js";
import { READ_ONLY } from "./annotations.js";
import type { SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { decodeEntities } from "../text.js";

// Extract braced GUID from LFSP/LFEP tokens, discarding trailing anchor letter
const FEATURE_LINK_RE = /LF([SE])P=\{([^}]+)\}[^;]*/g;

interface ResolvedFeature {
  name: string;
  owningElementName: string | null;
  notes: string | null;
  type: "attribute" | "operation";
}

function resolveFeatureGuid(db: Database, guid: string): ResolvedFeature | null {
  // Try attribute first
  const attr = db
    .prepare(
      `SELECT a.Name, a.Notes, o.Name as ElementName
       FROM t_attribute a LEFT JOIN t_object o ON a.Object_ID = o.Object_ID
       WHERE a.ea_guid = ? COLLATE NOCASE`
    )
    .get(guid) as { Name: string; Notes: string | null; ElementName: string | null } | undefined;
  if (attr) {
    return { name: attr.Name, owningElementName: attr.ElementName, notes: decodeEntities(attr.Notes), type: "attribute" };
  }

  // Try operation
  const op = db
    .prepare(
      `SELECT p.Name, p.Notes, o.Name as ElementName
       FROM t_operation p LEFT JOIN t_object o ON p.Object_ID = o.Object_ID
       WHERE p.ea_guid = ? COLLATE NOCASE`
    )
    .get(guid) as { Name: string; Notes: string | null; ElementName: string | null } | undefined;
  if (op) {
    return { name: op.Name, owningElementName: op.ElementName, notes: decodeEntities(op.Notes), type: "operation" };
  }

  return null;
}

function parseFeatureLinks(db: Database, styleEx: string | null) {
  if (!styleEx) return { sourceFeature: null, targetFeature: null };

  let sourceFeature: any = null;
  let targetFeature: any = null;

  let m: RegExpExecArray | null;
  FEATURE_LINK_RE.lastIndex = 0;
  while ((m = FEATURE_LINK_RE.exec(styleEx)) !== null) {
    const side = m[1]; // S = source, E = target
    const guid = `{${m[2]}}`;
    const resolved = resolveFeatureGuid(db, guid);

    const feature = resolved
      ? { resolved: true, ...resolved }
      : { resolved: false, present: true, guid };

    if (side === "S") sourceFeature = feature;
    else targetFeature = feature;
  }

  return { sourceFeature, targetFeature };
}

export function configureConnectorTools(server: McpServer, model: ModelAccess): void {
  server.tool(
    "ea_get_connectors",
    "Get all relationships (connectors) for a given element. `connectors` lists what the element is connected to and how (Realisation, Dependency, Association, etc.), each entry naming its `source` and `dest` ends. For Generalization connectors, `source` is always the specific (child) type and `dest` the general (parent) type \u2014 each end also carries a `role` making this explicit without needing to reason about direction. Filter by `connectorType` and `direction` to list an element's direct children (incoming Generalization) or direct parent(s) (outgoing Generalization) without a diagram. Feature links show which specific attribute or operation each end attaches to.",
    {
      elementId: z.coerce.number().describe("The Object_ID of the element to get connectors for"),
      connectorType: z
        .string()
        .optional()
        .describe("Filter by connector type (e.g., Realisation, Dependency, Association, InformationFlow, Generalization)"),
      direction: z
        .enum(["both", "outgoing", "incoming"])
        .default("both")
        .describe("Filter direction: outgoing (element is source), incoming (element is target), or both"),
    },
    READ_ONLY,
    async ({ elementId, connectorType, direction }) => {
      const db = await model.database();
      try {
        // Verify element exists
        const elExists = db.prepare("SELECT Object_ID FROM t_object WHERE Object_ID = ?").get(elementId);
        if (!elExists) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", message: `Element with ID ${elementId} not found`, elementId }, null, 2) }],
            isError: true,
          };
        }

        let conditions: string[] = [];
        const params: SQLInputValue[] = [];

        if (direction === "outgoing") {
          conditions.push("c.Start_Object_ID = ?");
          params.push(elementId);
        } else if (direction === "incoming") {
          conditions.push("c.End_Object_ID = ?");
          params.push(elementId);
        } else {
          conditions.push("(c.Start_Object_ID = ? OR c.End_Object_ID = ?)");
          params.push(elementId, elementId);
        }

        if (connectorType) {
          conditions.push("c.Connector_Type = ?");
          params.push(connectorType);
        }

        const sql = `
          SELECT c.Connector_ID, c.Connector_Type, c.SubType, c.Name, c.Direction,
                 c.Stereotype, c.Notes, c.SourceCard, c.DestCard,
                 c.Start_Object_ID, c.End_Object_ID,
                 c.SourceRole, c.DestRole, c.StyleEx,
                 src.Name as SourceName, src.Object_Type as SourceType, src.Stereotype as SourceStereotype,
                 dst.Name as DestName, dst.Object_Type as DestType, dst.Stereotype as DestStereotype
          FROM t_connector c
          LEFT JOIN t_object src ON c.Start_Object_ID = src.Object_ID
          LEFT JOIN t_object dst ON c.End_Object_ID = dst.Object_ID
          WHERE ${conditions.join(" AND ")}
          ORDER BY c.Connector_Type, c.Name
        `;

        const rows = db.prepare(sql).all(...params);

        const connectors = (rows as any[]).map((r) => {
          const { sourceFeature, targetFeature } = parseFeatureLinks(db, r.StyleEx);
          return {
            id: r.Connector_ID,
            type: r.Connector_Type,
            subType: r.SubType,
            name: r.Name,
            direction: r.Start_Object_ID === elementId ? "outgoing" : "incoming",
            stereotype: r.Stereotype,
            notes: decodeEntities(r.Notes),
            sourceCard: r.SourceCard,
            destCard: r.DestCard,
            sourceRole: r.SourceRole || null,
            destRole: r.DestRole || null,
            // Generalization: Start_Object_ID is always the specific (child) type, End_Object_ID the general (parent) type.
            source: { id: r.Start_Object_ID, name: r.SourceName, type: r.SourceType, stereotype: r.SourceStereotype, ...(r.Connector_Type === "Generalization" ? { role: "child" } : {}) },
            dest: { id: r.End_Object_ID, name: r.DestName, type: r.DestType, stereotype: r.DestStereotype, ...(r.Connector_Type === "Generalization" ? { role: "parent" } : {}) },
            sourceFeature,
            targetFeature,
          };
        });

        if (connectors.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              connectors: [],
              totalMatched: 0,
              returned: 0,
              truncated: false,
              _meta: { sourceTables: ["t_connector", "t_object", "t_attribute", "t_operation"] },
            }, null, 2) }],
          };
        }

        const response = {
          connectors,
          totalMatched: connectors.length,
          returned: connectors.length,
          truncated: false,
          _meta: { sourceTables: ["t_connector", "t_object", "t_attribute", "t_operation"] },
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error retrieving connectors: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
