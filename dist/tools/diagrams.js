import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { decodeEntities, foldText } from "../text.js";
import { buildPackagePath } from "../package-path.js";
import { breakdownApplies, buildBreakdown, buildContinuation, countBy, isTruncated, limitParam, offsetParam } from "./windowing.js";
// Reuse feature link parsing from connectors — import the module's export
// Since the feature link logic is internal to connectors, we inline a lightweight version here
const FEATURE_LINK_RE = /LF([SE])P=\{([^}]+)\}[^;]*/g;
function resolveFeatureGuid(db, guid) {
    const attr = db
        .prepare(`SELECT a.Name, a.Notes, o.Name as ElementName
       FROM t_attribute a LEFT JOIN t_object o ON a.Object_ID = o.Object_ID
       WHERE a.ea_guid = ? COLLATE NOCASE`)
        .get(guid);
    if (attr) {
        return { resolved: true, name: attr.Name, owningElementName: attr.ElementName, notes: decodeEntities(attr.Notes), type: "attribute" };
    }
    const op = db
        .prepare(`SELECT p.Name, p.Notes, o.Name as ElementName
       FROM t_operation p LEFT JOIN t_object o ON p.Object_ID = o.Object_ID
       WHERE p.ea_guid = ? COLLATE NOCASE`)
        .get(guid);
    if (op) {
        return { resolved: true, name: op.Name, owningElementName: op.ElementName, notes: decodeEntities(op.Notes), type: "operation" };
    }
    return { resolved: false, present: true, guid };
}
function parseFeatureLinks(db, styleEx) {
    if (!styleEx)
        return { sourceFeature: null, targetFeature: null };
    let sourceFeature = null;
    let targetFeature = null;
    let m;
    FEATURE_LINK_RE.lastIndex = 0;
    while ((m = FEATURE_LINK_RE.exec(styleEx)) !== null) {
        const side = m[1];
        const guid = `{${m[2]}}`;
        const feature = resolveFeatureGuid(db, guid);
        if (side === "S")
            sourceFeature = feature;
        else
            targetFeature = feature;
    }
    return { sourceFeature, targetFeature };
}
export function configureDiagramTools(server, model) {
    server.tool("ea_get_diagram_elements", "Get all elements and connectors placed on a specific diagram: the `diagram` itself, plus `elements` and `connectors`. Connectors include feature-link resolution showing which attribute or operation each end attaches to. The connector list is the union of explicit t_diagramlinks rows and implied connectors (both ends on the diagram).", {
        diagramId: z.coerce.number().describe("The Diagram_ID to get elements for"),
    }, READ_ONLY, async ({ diagramId }) => {
        const db = await model.database();
        try {
            const diagram = db.prepare(`
          SELECT d.Diagram_ID, d.Name, d.Diagram_Type, d.Package_ID, d.Notes,
                 p.Name as PackageName
          FROM t_diagram d
          LEFT JOIN t_package p ON d.Package_ID = p.Package_ID
          WHERE d.Diagram_ID = ?
        `).get(diagramId);
            if (!diagram) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ error: "not_found", message: `Diagram with ID ${diagramId} not found`, diagramId }, null, 2) }],
                    isError: true,
                };
            }
            const elements = db.prepare(`
          SELECT o.Object_ID, o.Object_Type, o.Name, o.Alias, o.Stereotype, o.Note
          FROM t_diagramobjects do_
          JOIN t_object o ON do_.Object_ID = o.Object_ID
          WHERE do_.Diagram_ID = ?
          ORDER BY do_.Sequence
        `).all(diagramId);
            const elementResults = elements.map((e) => {
                const result = { Object_ID: e.Object_ID, Object_Type: e.Object_Type, Name: e.Name, Alias: e.Alias, Stereotype: e.Stereotype };
                if (e.Object_Type === "Note")
                    result.Note = decodeEntities(e.Note);
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
        `).all(diagramId, diagramId, diagramId);
            const connectors = connectorRows.map((r) => {
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
                        type: "text",
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
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error retrieving diagram elements: ${msg}` }],
                isError: true,
            };
        }
    });
    // R7: List and search diagrams
    server.tool("ea_list_diagrams", "List diagrams in the model, optionally filtered by package, diagram type, and/or name substring. Each entry in `results` carries `diagramId`, `name`, `type`, `packagePath`, and `eaGuid`. Diagrams are ordered by the model's internal identity \u2014 stable but artificial, neither alphabetical nor the analyst's tree order \u2014 so adjacency carries no meaning. Walk a large result set with `offset` rather than a larger `limit`; while rows remain, `continuation` names the next call. When far more diagrams match than one window can hold, `breakdown` reports how many each type holds, so the next call can narrow by `diagramType` instead of paging.", {
        packageId: z.coerce.number().optional().describe("Filter to diagrams in this package"),
        diagramType: z.string().optional().describe("Filter by diagram type (e.g., Logical, Use Case, Sequence, Activity, Component)"),
        nameContains: z.string().optional().describe("Filter to diagrams whose name contains this substring (case- and diacritic-insensitive across European Latin alphabets)"),
        limit: limitParam(50),
        offset: offsetParam,
    }, READ_ONLY, async ({ packageId, diagramType, nameContains, limit, offset }) => {
        const db = await model.database();
        try {
            if (packageId != null) {
                const pkgExists = db.prepare("SELECT Package_ID FROM t_package WHERE Package_ID = ?").get(packageId);
                if (!pkgExists) {
                    return {
                        content: [{ type: "text", text: JSON.stringify({ error: "not_found", message: `Package with ID ${packageId} not found`, packageId }, null, 2) }],
                        isError: true,
                    };
                }
            }
            let sql = "SELECT Diagram_ID, Name, Diagram_Type, Package_ID, ea_guid FROM t_diagram WHERE 1=1";
            const params = [];
            if (packageId != null) {
                sql += " AND Package_ID = ?";
                params.push(packageId);
            }
            if (diagramType) {
                sql += " AND Diagram_Type = ?";
                params.push(diagramType);
            }
            // nameContains folds text, which SQLite cannot do, so the window is applied
            // in JS below; the ORDER BY is what makes that window repeatable.
            sql += " ORDER BY Diagram_ID";
            const allRows = db.prepare(sql).all(...params);
            let filtered = allRows;
            if (nameContains) {
                const folded = foldText(nameContains);
                filtered = allRows.filter((r) => foldText(r.Name || "").includes(folded));
            }
            const totalMatched = filtered.length;
            const window = filtered.slice(offset, offset + limit);
            const truncated = isTruncated(offset, window.length, totalMatched);
            const results = window.map((r) => ({
                diagramId: r.Diagram_ID,
                name: r.Name,
                type: r.Diagram_Type,
                packagePath: buildPackagePath(db, r.Package_ID),
                eaGuid: r.ea_guid,
            }));
            const breakdown = !diagramType && breakdownApplies(totalMatched, limit)
                ? buildBreakdown({ diagramType: countBy(filtered, (r) => r.Diagram_Type) })
                : undefined;
            const continuation = buildContinuation("ea_list_diagrams", { packageId, diagramType, nameContains, limit }, offset, results.length, totalMatched);
            const response = {
                results,
                totalMatched,
                returned: results.length,
                offset,
                truncated,
                ...(breakdown ? { breakdown } : {}),
                ...(continuation ? { continuation } : {}),
                _meta: { sourceTables: ["t_diagram", "t_package"] },
            };
            return {
                content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
            };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error listing diagrams: ${msg}` }],
                isError: true,
            };
        }
    });
}
