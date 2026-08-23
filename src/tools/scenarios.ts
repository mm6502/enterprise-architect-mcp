import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "../database.js";
import type { ModelAccess } from "../model-session.js";
import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import { decodeEntities, compareNames } from "../text.js";

interface ScenarioStep {
  stepNumber: number;
  name: string;
  level: number;
  guid: string;
  trigger: string | null;
  uses: string | null;
  useslist: string | null;
  result: string | null;
  state: string | null;
  link: string | null;
}

interface ParsedScenario {
  name: string;
  type: string;
  notes: string | null;
  steps: ScenarioStep[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "step",
});

function parseScenarioXml(xml: string | null): Omit<ScenarioStep, "stepNumber">[] {
  if (!xml || xml.trim() === "") return [];

  try {
    const parsed = xmlParser.parse(xml);
    const steps = parsed?.path?.step;
    if (!steps) return [];

    return (Array.isArray(steps) ? steps : [steps]).map((s: any) => ({
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
  } catch {
    return [];
  }
}

// R9: Scenario type ordering — Basic Path first, then Alternate, then Exception
const SCENARIO_TYPE_ORDER: Record<string, number> = {
  "Basic Path": 0,
  "Alternate": 1,
  "Exception": 2,
};

export function configureScenarioTools(server: McpServer, model: ModelAccess): void {
  server.tool(
    "ea_get_scenarios",
    "Get use case scenario flows for an element. `scenarios` holds the parsed flows; each has `name`, `type`, `notes`, and `steps`, and each step carries `stepNumber` plus its attributes (`trigger`, `uses`, `result`, `state`, `link`). Steps are numbered within each scenario. Scenarios ordered by type: Basic Path first, then Alternate, then Exception.",
    {
      elementId: z.coerce.number().describe("The Object_ID of the element (typically a UseCase) to get scenarios for"),
    },
    READ_ONLY,
    async ({ elementId }) => {
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

        const rows = db.prepare(`
          SELECT Scenario, ScenarioType, XMLContent, Notes
          FROM t_objectscenarios
          WHERE Object_ID = ?
        `).all(elementId) as any[];

        if (rows.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              scenarios: [],
              totalMatched: 0,
              returned: 0,
              truncated: false,
              _meta: { sourceTables: ["t_objectscenarios"] },
            }, null, 2) }],
          };
        }

        // R9: Sort by scenario type order, then by name within each type
        rows.sort((a: any, b: any) => {
          const aOrder = SCENARIO_TYPE_ORDER[a.ScenarioType] ?? 99;
          const bOrder = SCENARIO_TYPE_ORDER[b.ScenarioType] ?? 99;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return compareNames(a.Scenario, b.Scenario);
        });

        const scenarios: ParsedScenario[] = rows.map((row) => {
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
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error retrieving scenarios: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
