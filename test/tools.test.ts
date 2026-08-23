import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DatabaseSync } from "node:sqlite";
import { configureAllTools } from "../src/tools";
import { createTestDb, staticModel, TestDb } from "./helpers/test-db";

let client: Client;
let testDb: TestDb;
let db: DatabaseSync;

beforeAll(async () => {
  testDb = createTestDb();
  db = testDb.db;

  const server = new McpServer({
    name: "EA Test Server",
    version: "0.0.0",
  });
  configureAllTools(server, staticModel(db));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(() => {
  testDb.cleanup();
});

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as any[])[0]?.text;
  return {
    isError: (result as any).isError,
    text,
    json: () => JSON.parse(text),
  };
}

// ─── ea_search ───

describe("ea_search", () => {
  it("finds elements by name", async () => {
    const res = await callTool("ea_search", { query: "zmlúv" });
    const data = res.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results.some((e: any) => e.Name === "Správa zmlúv")).toBe(true);
    expect(data.totalMatched).toBeGreaterThan(0);
  });

  it("finds elements by alias", async () => {
    const res = await callTool("ea_search", { query: "UC_001" });
    const data = res.json();
    expect(data.results.some((e: any) => e.Alias === "UC_001")).toBe(true);
  });

  it("finds elements by note content", async () => {
    const res = await callTool("ea_search", { query: "Základná entita" });
    const data = res.json();
    expect(data.results.some((e: any) => e.Name === "Osoba")).toBe(true);
  });

  it("filters by objectType", async () => {
    const res = await callTool("ea_search", { query: "zml", objectType: "Class" });
    const data = res.json();
    expect(data.results.every((e: any) => e.Object_Type === "Class")).toBe(true);
  });

  it("filters by stereotype", async () => {
    const res = await callTool("ea_search", { query: "zml", stereotype: "Obrazovka" });
    const data = res.json();
    expect(data.results.length).toBe(1);
    expect(data.results[0].Stereotype).toBe("Obrazovka");
  });

  it("respects limit", async () => {
    const res = await callTool("ea_search", { query: "a", limit: 2 });
    const data = res.json();
    expect(data.results.length).toBeLessThanOrEqual(2);
    expect(data.returned).toBeLessThanOrEqual(2);
  });

  it("returns structured empty result when no matches", async () => {
    const res = await callTool("ea_search", { query: "nonexistent_xyz_12345" });
    const data = res.json();
    expect(data.results).toEqual([]);
    expect(data.totalMatched).toBe(0);
  });

  it("returns structured empty result for whitespace query", async () => {
    const res = await callTool("ea_search", { query: "   " });
    const data = res.json();
    expect(data.results).toEqual([]);
    expect(data.totalMatched).toBe(0);
    expect(data.error).toContain("empty");
  });

  it("includes PackageName in results", async () => {
    const res = await callTool("ea_search", { query: "Správa zmlúv" });
    const data = res.json();
    const uc = data.results.find((e: any) => e.Name === "Správa zmlúv");
    expect(uc.PackageName).toBe("Use Cases");
  });

  it("finds entity-encoded text after decoding (R3)", async () => {
    // Element 6 has note "Pr&#225;vnick&#225; osoba..." — search for decoded form
    const res = await callTool("ea_search", { query: "právnická" });
    const data = res.json();
    expect(data.results.some((e: any) => e.Name === "PRÁVNICKÁ OSOBA")).toBe(true);
  });

  it("matches case-insensitively across accented Latin text (R3)", async () => {
    const res = await callTool("ea_search", { query: "PRÁVNICKÁ" });
    const data = res.json();
    expect(data.results.some((e: any) => e.Name === "PRÁVNICKÁ OSOBA")).toBe(true);
  });

  it("matches infix (substring, not word boundary)", async () => {
    const res = await callTool("ea_search", { query: "vnick" });
    const data = res.json();
    expect(data.results.some((e: any) => e.Name === "PRÁVNICKÁ OSOBA")).toBe(true);
  });

  it("carries notePreviewTruncated flag on long notes", async () => {
    const res = await callTool("ea_search", { query: "výpis" });
    const data = res.json();
    const req = data.results.find((e: any) => e.Name === "Požiadavka na výpis");
    expect(req).toBeDefined();
    expect(req.notePreviewTruncated).toBe(true);
    expect(req.NotePreview.length).toBe(200);
  });

  it("reports totalMatched and continuation when capped", async () => {
    const res = await callTool("ea_search", { query: "a", limit: 2 });
    const data = res.json();
    if (data.totalMatched > 2) {
      expect(data.truncated).toBe(true);
      expect(data.continuation).toBeDefined();
      expect(data.continuation.tool).toBe("ea_search");
    }
  });

  it("finds matches in attribute notes", async () => {
    // Attribute 4 notes: "N&#225;zov pr&#225;vnickej osoby" → decoded "Názov právnickej osoby"
    const res = await callTool("ea_search", { query: "právnickej osoby" });
    const data = res.json();
    expect(data.results.length).toBeGreaterThan(0);
  });
});

// ─── ea_get_element ───

describe("ea_get_element", () => {
  it("returns full element with attributes and operations", async () => {
    const res = await callTool("ea_get_element", { elementId: 2 });
    const data = res.json();
    expect(data.Name).toBe("Zmluvná strana");
    expect(data.Object_Type).toBe("Class");
    expect(data.PackageName).toBe("Use Cases");
    expect(data.attributes).toHaveLength(3);
    expect(data.attributes[0].name).toBe("meno");
    expect(data.attributes[1].name).toBe("priezvisko");
    expect(data.operations).toHaveLength(2);
    expect(data.operations[0].name).toBe("getFullName");
    expect(data._meta.sourceTables).toContain("t_object");
    expect(data._meta.sourceTables).toContain("t_attribute");
  });

  it("includes operation parameters", async () => {
    const res = await callTool("ea_get_element", { elementId: 2 });
    const data = res.json();
    const setMeno = data.operations.find((op: any) => op.name === "setMeno");
    expect(setMeno.parameters).toHaveLength(1);
    expect(setMeno.parameters[0]).toEqual({
      name: "meno",
      type: "String",
      kind: "in",
      notes: "Nové meno",
    });
  });

  it("formats attribute multiplicity", async () => {
    const res = await callTool("ea_get_element", { elementId: 2 });
    const data = res.json();
    const meno = data.attributes.find((a: any) => a.name === "meno");
    expect(meno.multiplicity).toBe("1..1");
  });

  it("reports multiplicityIsUniform:false when attributes use multiplicity contrastively", async () => {
    const res = await callTool("ea_get_element", { elementId: 2 });
    const data = res.json();
    const values = data.attributes.map((a: any) => a.multiplicity);
    expect(values).toEqual(["1..1", "1..1", "0..1"]);
    expect(data._meta.attributes.multiplicityIsUniform).toBe(false);
  });

  it("reports multiplicityIsUniform:true when no attribute multiplicity contrast exists", async () => {
    const res = await callTool("ea_get_element", { elementId: 6 });
    const data = res.json();
    expect(data.attributes.every((a: any) => a.multiplicity === "1..1")).toBe(true);
    expect(data._meta.attributes.multiplicityIsUniform).toBe(true);
  });

  it("reports multiplicityIsUniform:true when the element has no attributes", async () => {
    const res = await callTool("ea_get_element", { elementId: 4 });
    const data = res.json();
    expect(data.attributes).toEqual([]);
    expect(data._meta.attributes.multiplicityIsUniform).toBe(true);
  });

  it("returns empty arrays when element has no attributes/operations", async () => {
    const res = await callTool("ea_get_element", { elementId: 4 });
    const data = res.json();
    expect(data.Name).toBe("Spracovanie žiadosti");
    expect(data.attributes).toEqual([]);
    expect(data.operations).toEqual([]);
  });

  it("returns structured error for non-existent element", async () => {
    const res = await callTool("ea_get_element", { elementId: 9999 });
    expect(res.isError).toBe(true);
    const data = res.json();
    expect(data.error).toBe("not_found");
    expect(data.elementId).toBe(9999);
  });

  it("returns diagrams the element appears on (R4)", async () => {
    const res = await callTool("ea_get_element", { elementId: 1 });
    const data = res.json();
    expect(data.diagrams).toBeDefined();
    expect(data.diagrams.length).toBeGreaterThan(0);
    expect(data.diagrams[0].name).toBe("UC Správa zmlúv");
    expect(data.diagrams[0].packagePath).toBe("Model.Analýza.Use Cases");
  });

  it("returns empty diagrams array for element on no diagram", async () => {
    const res = await callTool("ea_get_element", { elementId: 5 }); // Osoba in Analýza, not on any diagram
    const data = res.json();
    expect(data.diagrams).toEqual([]);
  });

  it("decodes entity-encoded notes on element", async () => {
    const res = await callTool("ea_get_element", { elementId: 6 }); // PRÁVNICKÁ OSOBA
    const data = res.json();
    expect(data.Note).toContain("Právnická osoba");
    expect(data.Note).toContain("&lt;&lt;modul&gt;&gt;");
  });

  it("returns constraints on element (R10)", async () => {
    const res = await callTool("ea_get_element", { elementId: 1 }); // UseCase with constraints
    const data = res.json();
    expect(data.constraints).toBeDefined();
    expect(data.constraints.length).toBe(2);
    const preCond = data.constraints.find((c: any) => c.type === "Pre-condition");
    expect(preCond.name).toBe("Spis je v stave uzatvorený");
    const process = data.constraints.find((c: any) => c.type === "Process");
    expect(process.name).toBe("Pravidlo nastavenia auditovanej činnosti");
    expect(process.notes).toContain("LOG_ABC_083");
  });

  it("returns constraints on element with no scenario (R10/A11)", async () => {
    const res = await callTool("ea_get_element", { elementId: 6 }); // PRÁVNICKÁ OSOBA — constraint but no scenario
    const data = res.json();
    expect(data.constraints.length).toBe(1);
    expect(data.constraints[0].type).toBe("Invariant");
    // Entity-decoded notes
    expect(data.constraints[0].notes).toContain("Právnická osoba musí mať platné IČO");
  });
});

// ─── ea_list_elements ───

describe("ea_list_elements", () => {
  it("lists elements in a package", async () => {
    const res = await callTool("ea_list_elements", { packageId: 3 });
    const data = res.json();
    expect(data.elements.length).toBe(6);
    expect(data.totalMatched).toBe(6);
    expect(data._meta.sourceTables).toContain("t_object");
  });

  it("filters by objectType", async () => {
    const res = await callTool("ea_list_elements", { packageId: 3, objectType: "Class" });
    const data = res.json();
    expect(data.elements.every((e: any) => e.Object_Type === "Class")).toBe(true);
    expect(data.elements).toHaveLength(2);
  });

  it("respects limit and reports truncation", async () => {
    const res = await callTool("ea_list_elements", { packageId: 3, limit: 2 });
    const data = res.json();
    expect(data.elements.length).toBeLessThanOrEqual(2);
    expect(data.truncated).toBe(true);
    expect(data.totalMatched).toBe(6);
    expect(data.continuation).toBeDefined();
  });

  it("returns empty array for package with no elements", async () => {
    const res = await callTool("ea_list_elements", { packageId: 1 });
    const data = res.json();
    expect(data.elements).toEqual([]);
    expect(data.totalMatched).toBe(0);
  });
});

// ─── ea_get_connectors ───

describe("ea_get_connectors", () => {
  it("returns all connectors for an element (both directions)", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 1 });
    const data = res.json();
    // OBJ 1 has: incoming Realisation from 3, outgoing Association to 2
    expect(data.connectors).toHaveLength(2);
    expect(data._meta.sourceTables).toContain("t_connector");
  });

  it("filters outgoing connectors", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 1, direction: "outgoing" });
    const data = res.json();
    expect(data.connectors.every((c: any) => c.source.id === 1)).toBe(true);
    expect(data.connectors).toHaveLength(1); // Association to Zmluvná strana
  });

  it("filters incoming connectors", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 1, direction: "incoming" });
    const data = res.json();
    expect(data.connectors.every((c: any) => c.dest.id === 1)).toBe(true);
    expect(data.connectors).toHaveLength(1); // Realisation from Screen
  });

  it("filters by connector type", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 2, connectorType: "Association" });
    const data = res.json();
    expect(data.connectors.every((c: any) => c.type === "Association")).toBe(true);
  });

  it("includes source and dest element details", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 3, direction: "outgoing" });
    const data = res.json();
    const real = data.connectors.find((c: any) => c.type === "Realisation");
    expect(real.source.name).toBe("Zoznam zmlúv");
    expect(real.dest.name).toBe("Správa zmlúv");
  });

  it("returns structured empty result when no connectors found", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 4 });
    const data = res.json();
    expect(data.connectors).toEqual([]);
    expect(data.totalMatched).toBe(0);
    expect(data.truncated).toBe(false);
  });

  it("returns error for non-existent element", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 999999 });
    expect(res.isError).toBe(true);
    const data = res.json();
    expect(data.error).toBe("not_found");
  });

  it("resolves feature link to attribute via StyleEx LFSP token", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 3, direction: "outgoing" });
    const data = res.json();
    const real = data.connectors.find((c: any) => c.type === "Realisation");
    expect(real.sourceFeature).toBeDefined();
    expect(real.sourceFeature.resolved).toBe(true);
    expect(real.sourceFeature.name).toBe("meno");
    expect(real.sourceFeature.owningElementName).toBe("Zmluvná strana");
    expect(real.sourceFeature.type).toBe("attribute");
  });

  it("resolves feature link with case-insensitive GUID", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 3, direction: "outgoing" });
    const data = res.json();
    const real = data.connectors.find((c: any) => c.type === "Realisation");
    expect(real.targetFeature).toBeDefined();
    expect(real.targetFeature.resolved).toBe(true);
    expect(real.targetFeature.name).toBe("názov");
  });

  it("decodes entity-encoded notes on resolved feature", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 3, direction: "outgoing" });
    const data = res.json();
    const real = data.connectors.find((c: any) => c.type === "Realisation");
    expect(real.targetFeature.notes).toBe("Názov právnickej osoby");
  });

  it("reports unresolvable feature link as present-but-unresolved", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 6 });
    const data = res.json();
    const conn4 = data.connectors.find((c: any) => c.id === 4);
    expect(conn4.sourceFeature).toBeDefined();
    expect(conn4.sourceFeature.resolved).toBe(false);
    expect(conn4.sourceFeature.present).toBe(true);
  });

  it("resolves feature link to operation", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 2 });
    const data = res.json();
    const conn5 = data.connectors.find((c: any) => c.id === 5);
    expect(conn5.sourceFeature.resolved).toBe(true);
    expect(conn5.sourceFeature.name).toBe("getFullName");
    expect(conn5.sourceFeature.type).toBe("operation");
  });

  it("returns null features for connector with no StyleEx", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 2 });
    const data = res.json();
    const conn3 = data.connectors.find((c: any) => c.id === 3);
    expect(conn3.sourceFeature).toBeNull();
    expect(conn3.targetFeature).toBeNull();
  });

  it("returns SourceRole and DestRole", async () => {
    const res = await callTool("ea_get_connectors", { elementId: 1 });
    const data = res.json();
    const assoc = data.connectors.find((c: any) => c.type === "Association");
    expect(assoc.sourceRole).toBe("Správca");
    expect(assoc.destRole).toBe("Zmluvná strana");
  });
});

// ─── ea_get_package_tree ───

describe("ea_get_package_tree", () => {
  it("returns top-level packages when no packageId given", async () => {
    const res = await callTool("ea_get_package_tree", {});
    const data = res.json();
    expect(data.packages).toHaveLength(1);
    expect(data.packages[0].name).toBe("Model");
  });

  it("returns children of a package", async () => {
    const res = await callTool("ea_get_package_tree", { packageId: 1 });
    const data = res.json();
    expect(data.packages).toHaveLength(2);
    expect(data.packages.map((p: any) => p.name)).toContain("Analýza");
    expect(data.packages.map((p: any) => p.name)).toContain("Architektúra");
  });

  it("includes elementCount per package", async () => {
    const res = await callTool("ea_get_package_tree", { packageId: 2 });
    const data = res.json();
    const useCases = data.packages.find((p: any) => p.name === "Use Cases");
    expect(useCases.elementCount).toBe(6); // 6 objects in PKG 3
  });

  it("recurses to specified depth", async () => {
    const res = await callTool("ea_get_package_tree", { packageId: 1, depth: 2 });
    const data = res.json();
    const analyza = data.packages.find((p: any) => p.name === "Analýza");
    expect(analyza.children).toBeDefined();
    expect(analyza.children).toHaveLength(1);
    expect(analyza.children[0].name).toBe("Use Cases");
  });

  it("caps depth at 3", async () => {
    const res = await callTool("ea_get_package_tree", { packageId: 0, depth: 10 });
    // Should not throw, just cap at 3
    const data = res.json();
    expect(data.packages).toBeDefined();
  });

  it("returns children of Architektúra including its Use Cases child", async () => {
    const res = await callTool("ea_get_package_tree", { packageId: 4 });
    const data = res.json();
    expect(data.packages).toHaveLength(1);
    expect(data.packages[0].name).toBe("Use Cases");
  });
});

// ─── ea_get_diagram_elements ───

describe("ea_get_diagram_elements", () => {
  it("returns diagram metadata and elements", async () => {
    const res = await callTool("ea_get_diagram_elements", { diagramId: 1 });
    const data = res.json();
    expect(data.diagram.name).toBe("UC Správa zmlúv");
    expect(data.diagram.type).toBe("Use Case");
    expect(data.diagram.packageName).toBe("Use Cases");
    expect(data.elements).toHaveLength(3);
  });

  it("preserves element ordering by Sequence", async () => {
    const res = await callTool("ea_get_diagram_elements", { diagramId: 1 });
    const data = res.json();
    expect(data.elements[0].Object_ID).toBe(1);
    expect(data.elements[1].Object_ID).toBe(2);
    expect(data.elements[2].Object_ID).toBe(3);
  });

  it("returns connectors on diagram including explicit links", async () => {
    const res = await callTool("ea_get_diagram_elements", { diagramId: 1 });
    const data = res.json();
    expect(data.connectors).toBeDefined();
    // Connector 1 has explicit t_diagramlinks row
    const conn1 = data.connectors.find((c: any) => c.id === 1);
    expect(conn1).toBeDefined();
  });

  it("returns implied connectors (both ends on diagram, no links row)", async () => {
    const res = await callTool("ea_get_diagram_elements", { diagramId: 1 });
    const data = res.json();
    // Connector 2 (Association, OBJ 1→2) has both ends on diagram 1 but no t_diagramlinks row
    const conn2 = data.connectors.find((c: any) => c.id === 2);
    expect(conn2).toBeDefined();
    expect(conn2.type).toBe("Association");
  });

  it("does not double-count connectors present in both explicit and implied", async () => {
    const res = await callTool("ea_get_diagram_elements", { diagramId: 1 });
    const data = res.json();
    const ids = data.connectors.map((c: any) => c.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it("marks hidden connectors", async () => {
    const res = await callTool("ea_get_diagram_elements", { diagramId: 2 });
    const data = res.json();
    const hiddenConn = data.connectors.find((c: any) => c.id === 4);
    expect(hiddenConn).toBeDefined();
    expect(hiddenConn.hidden).toBe(true);
  });

  it("carries feature-link resolution on diagram connectors", async () => {
    const res = await callTool("ea_get_diagram_elements", { diagramId: 1 });
    const data = res.json();
    const conn1 = data.connectors.find((c: any) => c.id === 1);
    expect(conn1.sourceFeature).toBeDefined();
    expect(conn1.sourceFeature.resolved).toBe(true);
  });

  it("returns structured error for non-existent diagram", async () => {
    const res = await callTool("ea_get_diagram_elements", { diagramId: 9999 });
    expect(res.isError).toBe(true);
    const data = res.json();
    expect(data.error).toBe("not_found");
  });
});

// ─── ea_get_scenarios ───

describe("ea_get_scenarios", () => {
  it("returns parsed scenario steps", async () => {
    const res = await callTool("ea_get_scenarios", { elementId: 1 });
    const data = res.json();
    expect(data.scenarios).toHaveLength(2);
    expect(data._meta.sourceTables).toContain("t_objectscenarios");

    const basic = data.scenarios.find((s: any) => s.type === "Basic Path");
    expect(basic.name).toBe("Basic Path");
    expect(basic.steps).toHaveLength(2);
    expect(basic.steps[0].name).toBe("Používateľ otvorí zoznam");
    expect(basic.steps[0].stepNumber).toBe(1);
    expect(basic.steps[1].name).toBe("Systém zobrazí údaje");
    expect(basic.steps[1].stepNumber).toBe(2);
  });

  it("parses alternate scenarios", async () => {
    const res = await callTool("ea_get_scenarios", { elementId: 1 });
    const data = res.json();
    const alt = data.scenarios.find((s: any) => s.type === "Alternate");
    expect(alt.steps).toHaveLength(1);
    expect(alt.steps[0].name).toBe("Zmluvná strana neexistuje");
    expect(alt.steps[0].stepNumber).toBe(1);
  });

  it("returns all step attributes (R8)", async () => {
    const res = await callTool("ea_get_scenarios", { elementId: 1 });
    const data = res.json();
    const basic = data.scenarios.find((s: any) => s.type === "Basic Path");
    const step1 = basic.steps[0];
    expect(step1.trigger).toBe("Používateľ");
    expect(step1.link).toBe("{OBJ-0003}");
    const step2 = basic.steps[1];
    expect(step2.uses).toBe("UC_001");
    expect(step2.useslist).toBe("{OBJ-0002}");
    expect(step2.result).toBe("Zoznam");
  });

  it("returns scenario-level notes (R8)", async () => {
    const res = await callTool("ea_get_scenarios", { elementId: 1 });
    const data = res.json();
    const basic = data.scenarios.find((s: any) => s.type === "Basic Path");
    expect(basic.notes).toBe("Poznámka k základnému scenáru");
    const alt = data.scenarios.find((s: any) => s.type === "Alternate");
    expect(alt.notes).toBe("Alternatívny scenár");
  });

  it("orders Basic Path before Alternate (R9)", async () => {
    const res = await callTool("ea_get_scenarios", { elementId: 1 });
    const data = res.json();
    expect(data.scenarios[0].type).toBe("Basic Path");
    expect(data.scenarios[1].type).toBe("Alternate");
  });

  it("includes guid and level in steps", async () => {
    const res = await callTool("ea_get_scenarios", { elementId: 1 });
    const data = res.json();
    const step = data.scenarios[0].steps[0];
    expect(step.guid).toBeDefined();
    expect(typeof step.level).toBe("number");
  });

  it("returns structured empty result when no scenarios exist", async () => {
    const res = await callTool("ea_get_scenarios", { elementId: 2 });
    const data = res.json();
    expect(data.scenarios).toEqual([]);
    expect(data.totalMatched).toBe(0);
    expect(data.truncated).toBe(false);
  });
});

// ─── ea_resolve ───

describe("ea_resolve", () => {
  it("resolves braced GUID to element", async () => {
    const res = await callTool("ea_resolve", { reference: "{OBJ-0001}" });
    const data = res.json();
    expect(data.totalMatched).toBeGreaterThan(0);
    const el = data.candidates.find((c: any) => c.type === "element");
    expect(el).toBeDefined();
    expect(el.match).toBe("guid");
    expect(el.name).toBe("Správa zmlúv");
    expect(el.fullPackagePath).toBe("Model.Analýza.Use Cases");
  });

  it("resolves GUID with kind=diagram filter", async () => {
    const res = await callTool("ea_resolve", { reference: "{DIAG-0001}", kind: "diagram" });
    const data = res.json();
    expect(data.totalMatched).toBe(1);
    expect(data.candidates[0].type).toBe("diagram");
    expect(data.candidates[0].name).toBe("UC Správa zmlúv");
  });

  it("resolves unique name to single candidate", async () => {
    const res = await callTool("ea_resolve", { reference: "Zmluvná strana" });
    const data = res.json();
    expect(data.totalMatched).toBe(1);
    expect(data.candidates[0].name).toBe("Zmluvná strana");
    expect(data.candidates[0].match).toBe("exact");
  });

  it("resolves names case- and diacritic-insensitively", async () => {
    const res = await callTool("ea_resolve", { reference: "zmluvna strana" });
    const data = res.json();
    expect(data.totalMatched).toBe(1);
    expect(data.candidates[0]).toMatchObject({
      name: "Zmluvná strana",
      match: "exact",
    });
  });

  it("resolves a code prefix from a conventionally named element", async () => {
    const res = await callTool("ea_resolve", { reference: "OA_ABC_2280" });
    const data = res.json();
    expect(data.totalMatched).toBe(1);
    expect(data.candidates[0]).toMatchObject({
      type: "element",
      id: 9,
      name: "OA_ABC_2280: Vstupné parametre",
      match: "prefix",
    });
  });

  it("prioritizes an exact name over code-prefix candidates", async () => {
    const res = await callTool("ea_resolve", { reference: "UC_ABC_2079" });
    const data = res.json();
    expect(data.totalMatched).toBe(1);
    expect(data.candidates[0]).toMatchObject({
      id: 10,
      name: "UC_ABC_2079",
      match: "exact",
    });
  });

  it("resolves duplicate name to multiple candidates with distinguishing paths", async () => {
    const res = await callTool("ea_resolve", { reference: "Osoba", kind: "element" });
    const data = res.json();
    expect(data.totalMatched).toBe(2);
    const paths = data.candidates.map((c: any) => c.fullPackagePath);
    expect(paths).toContain("Model.Analýza");
    expect(paths).toContain("Model.Architektúra.Use Cases");
  });

  it("resolves duplicate diagram name to multiple candidates", async () => {
    const res = await callTool("ea_resolve", { reference: "UC Správa zmlúv", kind: "diagram" });
    const data = res.json();
    expect(data.totalMatched).toBe(2);
  });

  it("returns empty candidates for unresolvable reference", async () => {
    const res = await callTool("ea_resolve", { reference: "{NONEXISTENT-GUID}" });
    const data = res.json();
    expect(data.totalMatched).toBe(0);
    expect(data.candidates).toEqual([]);
  });

  // Guards the defect where prefix fallback shipped without the description announcing it.
  it("documents the prefix fallback and every match value in its tool description", async () => {
    const { tools } = await client.listTools();
    const description = tools.find((t) => t.name === "ea_resolve")?.description ?? "";
    expect(description).toMatch(/prefix/i);
    for (const value of ["exact", "prefix", "guid"]) {
      expect(description).toContain(`"${value}"`);
    }
  });
});

// ─── ea_list_diagrams ───

describe("ea_list_diagrams", () => {
  it("lists all diagrams", async () => {
    const res = await callTool("ea_list_diagrams", {});
    const data = res.json();
    expect(data.results.length).toBe(2);
    expect(data.totalMatched).toBe(2);
  });

  it("filters by package", async () => {
    const res = await callTool("ea_list_diagrams", { packageId: 3 });
    const data = res.json();
    expect(data.results.length).toBe(1);
    expect(data.results[0].name).toBe("UC Správa zmlúv");
  });

  it("filters by name substring (case-insensitive)", async () => {
    const res = await callTool("ea_list_diagrams", { nameContains: "správa" });
    const data = res.json();
    expect(data.results.length).toBe(2); // Both diagrams match
  });

  it("reports totalMatched and truncation", async () => {
    const res = await callTool("ea_list_diagrams", { limit: 1 });
    const data = res.json();
    expect(data.returned).toBe(1);
    expect(data.totalMatched).toBe(2);
    expect(data.truncated).toBe(true);
    expect(data.continuation).toBeDefined();
  });
});

// ─── ea_get_schema ───

describe("ea_get_schema", () => {
  it("lists all tables with row counts", async () => {
    const res = await callTool("ea_get_schema", {});
    const data = res.json();
    expect(Array.isArray(data.tables)).toBe(true);
    const tObject = data.tables.find((t: any) => t.table === "t_object");
    expect(tObject).toBeDefined();
    expect(tObject.rowCount).toBeGreaterThan(0);
    expect(data._meta.sourceTables).toContain("sqlite_master");
  });

  it("returns columns and types for a named table", async () => {
    const res = await callTool("ea_get_schema", { tableName: "t_object" });
    const data = res.json();
    expect(data.table).toBe("t_object");
    expect(data.columns.some((c: any) => c.name === "Object_ID")).toBe(true);
    expect(data.columns.some((c: any) => c.name === "Name")).toBe(true);
  });

  it("reports rowid alias for single INTEGER pk tables", async () => {
    const res = await callTool("ea_get_schema", { tableName: "t_object" });
    const data = res.json();
    expect(data.rowidAlias).toBe("Object_ID");
  });

  it("reports no rowid alias for tables without single INTEGER pk", async () => {
    const res = await callTool("ea_get_schema", { tableName: "t_diagramobjects" });
    const data = res.json();
    expect(data.rowidAlias).toBeNull();
  });

  it("returns indexes for a table", async () => {
    const res = await callTool("ea_get_schema", { tableName: "t_attribute" });
    const data = res.json();
    expect(data.indexes.length).toBeGreaterThan(0);
    const guidIdx = data.indexes.find((i: any) => i.columns.includes("ea_guid"));
    expect(guidIdx).toBeDefined();
    expect(guidIdx.unique).toBe(true);
  });

  it("returns structured error for nonexistent table", async () => {
    const res = await callTool("ea_get_schema", { tableName: "nonexistent_table" });
    expect(res.isError).toBe(true);
    const data = res.json();
    expect(data.error).toBe("not_found");
  });
});

// ─── ea_get_model_info ───

describe("ea_get_model_info", () => {
  it("returns file name, size, and modification time", async () => {
    const res = await callTool("ea_get_model_info", {});
    const data = res.json();
    expect(data.fileName).toBe("test-model.qea");
    expect(data.fileSizeBytes).toBeGreaterThan(0);
    expect(data.lastModified).toBeDefined();
    expect(data.resolvedPath).toContain("test-model.qea");
    expect(data.resolvedPathNote).toContain("local detail");
  });
});
