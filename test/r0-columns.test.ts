/**
 * R0 structural assertion: every table columns() reports for a tool's
 * prepared statements appears in that tool's declared sourceTables.
 */
import { DatabaseSync } from "node:sqlite";
import { createTestDb, TestDb } from "./helpers/test-db";

let testDb: TestDb;
let db: DatabaseSync;

beforeAll(() => {
  testDb = createTestDb();
  db = testDb.db;
});

afterAll(() => {
  testDb.cleanup();
});

function tablesFromColumns(stmt: any): Set<string> {
  const cols = stmt.columns() as { table: string | null }[];
  const tables = new Set<string>();
  for (const c of cols) {
    if (c.table) tables.add(c.table);
  }
  return tables;
}

function assertColumnsSubset(sqlLabel: string, stmt: any, declared: string[]) {
  const actual = tablesFromColumns(stmt);
  const declaredSet = new Set(declared);
  for (const t of actual) {
    if (!declaredSet.has(t)) {
      fail(`${sqlLabel}: columns() reported table "${t}" not in declared sourceTables [${declared.join(", ")}]`);
    }
  }
}

describe("R0 columns() ⊆ declared sourceTables", () => {
  it("ea_get_element main query", () => {
    const stmt = db.prepare(`
      SELECT o.Object_ID, o.Object_Type, o.Name, o.Alias, o.Stereotype,
             o.Package_ID, p.Name as PackageName, o.Note, o.Status,
             o.Author, o.CreatedDate, o.ModifiedDate, o.Phase, o.Complexity
      FROM t_object o
      LEFT JOIN t_package p ON o.Package_ID = p.Package_ID
      WHERE o.Object_ID = 1
    `);
    assertColumnsSubset("ea_get_element", stmt,
      ["t_object", "t_package", "t_attribute", "t_operation", "t_operationparams", "t_diagramobjects", "t_diagram", "t_objectconstraint"]);
  });

  it("ea_get_element attributes query", () => {
    const stmt = db.prepare(`
      SELECT ID, Name, Type, Scope, Stereotype, Notes, LowerBound, UpperBound, "Default"
      FROM t_attribute WHERE Object_ID = 1 ORDER BY Pos
    `);
    assertColumnsSubset("ea_get_element/attributes", stmt,
      ["t_object", "t_package", "t_attribute", "t_operation", "t_operationparams", "t_diagramobjects", "t_diagram", "t_objectconstraint"]);
  });

  it("ea_get_element constraints query", () => {
    const stmt = db.prepare(`
      SELECT "Constraint" as name, ConstraintType, Notes, Status
      FROM t_objectconstraint WHERE Object_ID = 1
    `);
    assertColumnsSubset("ea_get_element/constraints", stmt,
      ["t_object", "t_package", "t_attribute", "t_operation", "t_operationparams", "t_diagramobjects", "t_diagram", "t_objectconstraint"]);
  });

  it("ea_get_connectors", () => {
    const stmt = db.prepare(`
      SELECT c.Connector_ID, c.Connector_Type, c.SubType, c.Name, c.Direction,
             c.Stereotype, c.Notes, c.SourceCard, c.DestCard,
             c.Start_Object_ID, c.End_Object_ID,
             c.SourceRole, c.DestRole, c.StyleEx,
             src.Name as SourceName, src.Object_Type as SourceType, src.Stereotype as SourceStereotype,
             dst.Name as DestName, dst.Object_Type as DestType, dst.Stereotype as DestStereotype
      FROM t_connector c
      LEFT JOIN t_object src ON c.Start_Object_ID = src.Object_ID
      LEFT JOIN t_object dst ON c.End_Object_ID = dst.Object_ID
      WHERE c.Start_Object_ID = 1
    `);
    assertColumnsSubset("ea_get_connectors", stmt,
      ["t_connector", "t_object", "t_attribute", "t_operation"]);
  });

  it("ea_get_diagram_elements — elements query", () => {
    const stmt = db.prepare(`
      SELECT o.Object_ID, o.Object_Type, o.Name, o.Alias, o.Stereotype
      FROM t_diagramobjects do_
      JOIN t_object o ON do_.Object_ID = o.Object_ID
      WHERE do_.Diagram_ID = 1 ORDER BY do_.Sequence
    `);
    assertColumnsSubset("ea_get_diagram_elements/elements", stmt,
      ["t_diagram", "t_package", "t_diagramobjects", "t_object", "t_connector", "t_diagramlinks", "t_attribute", "t_operation"]);
  });

  it("ea_get_diagram_elements — connectors union query", () => {
    const stmt = db.prepare(`
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
      LEFT JOIN t_diagramlinks dl ON dl.ConnectorID = c.Connector_ID AND dl.DiagramID = 1
      WHERE dl.ConnectorID IS NOT NULL
        OR (c.Start_Object_ID IN (SELECT Object_ID FROM t_diagramobjects WHERE Diagram_ID = 1)
            AND c.End_Object_ID IN (SELECT Object_ID FROM t_diagramobjects WHERE Diagram_ID = 1))
    `);
    assertColumnsSubset("ea_get_diagram_elements/connectors", stmt,
      ["t_diagram", "t_package", "t_diagramobjects", "t_object", "t_connector", "t_diagramlinks", "t_attribute", "t_operation"]);
  });

  it("ea_list_elements", () => {
    const stmt = db.prepare(`
      SELECT Object_ID, Object_Type, Name, Alias, Stereotype
      FROM t_object WHERE Package_ID = 1 ORDER BY Object_Type, Name LIMIT 50
    `);
    assertColumnsSubset("ea_list_elements", stmt, ["t_object"]);
  });

  it("ea_get_scenarios", () => {
    const stmt = db.prepare(`
      SELECT Scenario, ScenarioType, XMLContent, Notes
      FROM t_objectscenarios WHERE Object_ID = 1
    `);
    assertColumnsSubset("ea_get_scenarios", stmt, ["t_objectscenarios"]);
  });

  it("ea_search element fetch", () => {
    const stmt = db.prepare(`
      SELECT o.Object_ID, o.Object_Type, o.Name, o.Alias, o.Stereotype,
             o.Package_ID, p.Name as PackageName, o.Note
      FROM t_object o
      LEFT JOIN t_package p ON o.Package_ID = p.Package_ID
      WHERE o.Object_ID IN (1)
    `);
    assertColumnsSubset("ea_search", stmt,
      ["t_object", "t_attribute", "t_operation", "t_objectconstraint", "t_package"]);
  });

  it("ea_list_diagrams", () => {
    const stmt = db.prepare(`
      SELECT Diagram_ID, Name, Diagram_Type, Package_ID, ea_guid
      FROM t_diagram WHERE 1=1
    `);
    assertColumnsSubset("ea_list_diagrams", stmt, ["t_diagram", "t_package"]);
  });

  it("ea_resolve — element lookup", () => {
    const stmt = db.prepare(`
      SELECT Object_ID, Object_Type, Name, Package_ID, ea_guid
      FROM t_object WHERE ea_guid = '{OBJ-0001}' COLLATE NOCASE
    `);
    assertColumnsSubset("ea_resolve/element", stmt, ["t_object", "t_diagram", "t_package"]);
  });

  it("ea_get_schema — table list", () => {
    const stmt = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `);
    assertColumnsSubset("ea_get_schema", stmt, ["sqlite_master"]);
  });

  it("feature link resolution — attribute lookup", () => {
    const stmt = db.prepare(`
      SELECT a.Name, a.Notes, o.Name as ElementName
      FROM t_attribute a LEFT JOIN t_object o ON a.Object_ID = o.Object_ID
      WHERE a.ea_guid = '{ATTR-0001}' COLLATE NOCASE
    `);
    // Feature resolution runs inside ea_get_connectors and ea_get_diagram_elements
    assertColumnsSubset("feature-link/attribute", stmt,
      ["t_connector", "t_object", "t_attribute", "t_operation"]);
  });
});
