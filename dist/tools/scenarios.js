import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import { decodeEntities } from "../text.js";
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "step",
});
function parseScenarioXml(xml) {
    if (!xml || xml.trim() === "")
        return [];
    try {
        const parsed = xmlParser.parse(xml);
        const steps = parsed?.path?.step;
        if (!steps)
            return [];
        return (Array.isArray(steps) ? steps : [steps]).map((s) => ({
            name: s["@_name"] || "",
            level: parseInt(s["@_level"] || "0", 10),
            guid: s["@_guid"] || "",
            trigger: s["@_trigger"] || null,
            uses: s["@_uses"] || null,
            useslist: s["@_useslist"] || null,
            result: s["@_result"] || null,
            state: s["@_state"] || null,
            link: s["@_link"] || null,
        }));
    }
    catch {
        return [];
    }
}
// R9: Scenario type ordering — Basic Path first, then Alternate, then Exception
const SCENARIO_TYPE_ORDER = {
    "Basic Path": 0,
    "Alternate": 1,
    "Exception": 2,
};
export function configureScenarioTools(server, model) {
    server.tool("ea_get_scenarios", "Get use case scenario flows for an element. `scenarios` holds the parsed flows; each has `name`, `type`, `notes`, and `steps`, and each step carries `stepNumber` plus its attributes (`trigger`, `uses`, `result`, `state`, `link`). Steps are numbered within each scenario. Scenarios ordered by type: Basic Path first, then Alternate, then Exception.", {
        elementId: z.coerce.number().describe("The Object_ID of the element (typically a UseCase) to get scenarios for"),
    }, READ_ONLY, async ({ elementId }) => {
        const db = await model.database();
        try {
            // Verify element exists
            const elExists = db.prepare("SELECT Object_ID FROM t_object WHERE Object_ID = ?").get(elementId);
            if (!elExists) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ error: "not_found", message: `Element with ID ${elementId} not found`, elementId }, null, 2) }],
                    isError: true,
                };
            }
            const rows = db.prepare(`
          SELECT Scenario, ScenarioType, XMLContent, Notes
          FROM t_objectscenarios
          WHERE Object_ID = ?
        `).all(elementId);
            if (rows.length === 0) {
                return {
                    content: [{ type: "text", text: JSON.stringify({
                                scenarios: [],
                                totalMatched: 0,
                                returned: 0,
                                truncated: false,
                                _meta: { sourceTables: ["t_objectscenarios"] },
                            }, null, 2) }],
                };
            }
            // R9: Sort by scenario type order, then by name within each type
            rows.sort((a, b) => {
                const aOrder = SCENARIO_TYPE_ORDER[a.ScenarioType] ?? 99;
                const bOrder = SCENARIO_TYPE_ORDER[b.ScenarioType] ?? 99;
                if (aOrder !== bOrder)
                    return aOrder - bOrder;
                return (a.Scenario || "").localeCompare(b.Scenario || "", "sk");
            });
            const scenarios = rows.map((row) => {
                const rawSteps = parseScenarioXml(row.XMLContent);
                return {
                    name: row.Scenario,
                    type: row.ScenarioType,
                    notes: decodeEntities(row.Notes),
                    steps: rawSteps.map((s, i) => ({ stepNumber: i + 1, ...s })),
                };
            });
            const response = {
                scenarios,
                totalMatched: scenarios.length,
                returned: scenarios.length,
                truncated: false,
                _meta: { sourceTables: ["t_objectscenarios"] },
            };
            return {
                content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
            };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error retrieving scenarios: ${msg}` }],
                isError: true,
            };
        }
    });
}
