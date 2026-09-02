import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ModelAccess } from "../../src/model-session";
import { EA_SCHEMA } from "./ea-schema.js";

export interface TestDb {
  db: DatabaseSync;
  dbPath: string;
  cleanup: () => void;
}

/** An already-open model, so tool tests never reach the path prompt. */
export function staticModel(db: DatabaseSync): ModelAccess {
  return {
    database: async () => db,
    // Once a database is open it always has an origin. Both lists are populated so the
    // description contract sees the nested provenance fields, not just the empty arrays.
    origin: () => ({
      source: "argument",
      configured: db.location() ?? "",
      ignored: [
        { source: "environment", configured: "/nowhere/model.qea", reason: 'Path not found: "/nowhere/model.qea"' },
      ],
      shadowed: [{ source: "dotenv", configured: "/elsewhere/model.qea" }],
    }),
  };
}

/**
 * Creates a file-based .qea SQLite database with the EA schema and seed data for testing.
 * Carries the model's awkward shapes: entity-encoded notes, uppercase Slovak diacritics,
 * StyleEx tokens, missing t_diagramlinks rows, duplicate names, reserved-word columns.
 */
export function createTestDb(): TestDb {
  const tempDir = mkdtempSync(join(tmpdir(), "ea-test-"));
  const dbPath = join(tempDir, "test-model.qea");
  const db = new DatabaseSync(dbPath);

  db.exec(EA_SCHEMA);

  // --- Seed packages (including a duplicate name) ---
  const insertPkg = db.prepare(
    "INSERT INTO t_package (Package_ID, Name, Parent_ID, ea_guid, TPos) VALUES (?, ?, ?, ?, ?)"
  );
  insertPkg.run(1, "Model", 0, "{PKG-0001}", 0);
  insertPkg.run(2, "Analýza", 1, "{PKG-0002}", 0);
  insertPkg.run(3, "Use Cases", 2, "{PKG-0003}", 0);
  insertPkg.run(4, "Architektúra", 1, "{PKG-0004}", 1);
  insertPkg.run(5, "Use Cases", 4, "{PKG-0005}", 0); // duplicate name under different parent
  insertPkg.run(6, "Resolve fixtures", 5, "{PKG-0006}", 1);

  // --- Seed objects ---
  const insertObj = db.prepare(
    `INSERT INTO t_object (Object_ID, Object_Type, Name, Alias, Stereotype, Package_ID, Note, Status, Author, ea_guid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertObj.run(1, "UseCase", "Správa zmlúv", "UC_001", "UseCase", 3,
    "Hlavný use case pre správu zmlúv v systéme", "Approved", "admin", "{OBJ-0001}");
  insertObj.run(2, "Class", "Zmluvná strana", null, "Entity", 3,
    "Entita reprezentujúca zmluvnú stranu", "Approved", "admin", "{OBJ-0002}");
  insertObj.run(3, "Screen", "Zoznam zmlúv", null, "Obrazovka", 3,
    "Obrazovka so zoznamom zmlúv", "Proposed", "admin", "{OBJ-0003}");
  insertObj.run(4, "Activity", "Spracovanie žiadosti", null, null, 3,
    null, null, "admin", "{OBJ-0004}");
  insertObj.run(5, "Class", "Osoba", "Person", "Entity", 2,
    "Základná entita pre osobu v systéme", "Approved", "admin", "{OBJ-0005}");
  // Entity-encoded note + uppercase Slovak name (R3 test shapes)
  insertObj.run(6, "Class", "PRÁVNICKÁ OSOBA", null, "Entity", 3,
    "Pr&#225;vnick&#225; osoba (&lt;&lt;modul&gt;&gt;) - D&#225;tum spracovania &lt;&gt; null",
    "Approved", "admin", "{OBJ-0006}");
  // Duplicate element name in different package
  insertObj.run(7, "Class", "Osoba", null, "Entity", 5,
    "Osoba v architektúre", "Approved", "admin", "{OBJ-0007}");
  // Element with a long note whose distinctive term sits past the preview window
  insertObj.run(8, "Requirement", "Požiadavka na výpis", null, null, 3,
    "Systém eviduje podanie a jeho spracovanie v lehote určenej predpisom. ".repeat(3) +
    "Osobitné ustanovenie o preddavku sa uplatní až po uplynutí lehoty.",
    "Proposed", "admin", "{OBJ-0008}");
  insertObj.run(9, "Class", "OA_ABC_2280: Vstupné parametre", null, null, 6,
    "Vstupné parametre pre obrazovku", "Approved", "admin", "{OBJ-0009}");
  insertObj.run(10, "UseCase", "UC_ABC_2079", null, null, 6,
    "Presný názov pre prioritu resolve", "Approved", "admin", "{OBJ-0010}");
  insertObj.run(11, "UseCase", "UC_ABC_2079: Spracovanie žiadosti", null, null, 6,
    "Prefixový názov pre prioritu resolve", "Approved", "admin", "{OBJ-0011}");

  // --- Seed attributes with ea_guid (for R1 feature link resolution) ---
  const insertAttr = db.prepare(
    `INSERT INTO t_attribute (ID, Object_ID, Name, Type, Scope, Stereotype, Notes, LowerBound, UpperBound, "Default", Pos, ea_guid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertAttr.run(1, 2, "meno", "String", "Public", null, "Krstné meno", "1", "1", null, 0, "{ATTR-0001}");
  insertAttr.run(2, 2, "priezvisko", "String", "Public", null, "Priezvisko zmluvnej strany", "1", "1", null, 1, "{ATTR-0002}");
  insertAttr.run(3, 2, "datumNarodenia", "Date", "Public", null, null, "0", "1", null, 2, "{ATTR-0003}");
  // Attribute with entity-encoded notes
  insertAttr.run(4, 6, "názov", "String", "Public", null, "N&#225;zov pr&#225;vnickej osoby", "1", "1", null, 0, "{ATTR-0004}");

  // --- Seed operations with ea_guid ---
  const insertOp = db.prepare(
    "INSERT INTO t_operation (OperationID, Object_ID, Name, Type, Scope, Stereotype, Notes, Pos, ea_guid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insertOp.run(1, 2, "getFullName", "String", "Public", null, "Returns full name", 0, "{OP-0001}");
  insertOp.run(2, 2, "setMeno", "void", "Public", null, null, 1, "{OP-0002}");

  // --- Seed operation params ---
  const insertParam = db.prepare(
    "INSERT INTO t_operationparams (OperationID, Name, Type, Kind, Notes, Pos) VALUES (?, ?, ?, ?, ?, ?)"
  );
  insertParam.run(2, "meno", "String", "in", "Nové meno", 0);

  // --- Seed connectors with StyleEx and roles ---
  const insertConn = db.prepare(
    `INSERT INTO t_connector (Connector_ID, Connector_Type, SubType, Name, Direction, Stereotype, Notes, SourceCard, DestCard, Start_Object_ID, End_Object_ID, SourceRole, DestRole, StyleEx)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Connector with feature link: source end → attribute {ATTR-0001} (with trailing L), target end → attribute {ATTR-0004} (with trailing R)
  insertConn.run(1, "Realisation", null, null, "Source -> Destination", null, null, null, null, 3, 1,
    null, null, "LFSP={ATTR-0001}L;LFEP={attr-0004}R;");
  // Connector with roles, no feature link
  insertConn.run(2, "Association", null, "uses", "Source -> Destination", null, null, "1", "*", 1, 2,
    "Správca", "Zmluvná strana", null);
  // Connector with no StyleEx
  insertConn.run(3, "Dependency", null, null, "Source -> Destination", null, null, null, null, 2, 5,
    null, null, null);
  // Connector for implied diagram link test: both ends (OBJ 1, 2) on diagram 1, but NO t_diagramlinks row
  // (connectors 1 and 2 are already between objects on diagram 1)
  // Connector with unresolvable feature link
  insertConn.run(4, "Association", null, null, "Source -> Destination", null, null, null, null, 6, 7,
    null, null, "LFSP={NONEXISTENT-GUID}L;");
  // Connector for feature link to operation
  insertConn.run(5, "Dependency", null, null, "Source -> Destination", null, null, null, null, 2, 6,
    null, null, "LFSP={OP-0001}L;");

  // --- Seed diagrams (including duplicate name) ---
  db.prepare(
    "INSERT INTO t_diagram (Diagram_ID, Name, Diagram_Type, Package_ID, Notes, ea_guid) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(1, "UC Správa zmlúv", "Use Case", 3, "Diagram use casov", "{DIAG-0001}");
  db.prepare(
    "INSERT INTO t_diagram (Diagram_ID, Name, Diagram_Type, Package_ID, Notes, ea_guid) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(2, "UC Správa zmlúv", "Use Case", 5, "Duplicitný diagram", "{DIAG-0002}"); // duplicate name

  // --- Seed diagram objects ---
  const insertDiagObj = db.prepare(
    "INSERT INTO t_diagramobjects (Diagram_ID, Object_ID, Sequence) VALUES (?, ?, ?)"
  );
  insertDiagObj.run(1, 1, 1); // Správa zmlúv
  insertDiagObj.run(1, 2, 2); // Zmluvná strana
  insertDiagObj.run(1, 3, 3); // Zoznam zmlúv
  insertDiagObj.run(2, 6, 1); // PRÁVNICKÁ OSOBA
  insertDiagObj.run(2, 7, 2); // Osoba (in Architektúra)

  // --- Seed diagram links ---
  // Only connector 1 has an explicit link row; connector 2 between OBJ 1 and OBJ 2
  // (both on diagram 1) is implied — no t_diagramlinks row.
  const insertDiagLink = db.prepare(
    "INSERT INTO t_diagramlinks (DiagramID, ConnectorID, Hidden) VALUES (?, ?, ?)"
  );
  insertDiagLink.run(1, 1, 0); // explicit link for connector 1
  // connector 2 is implied (both ends on diagram 1, no row here)
  insertDiagLink.run(2, 4, 1); // hidden link on diagram 2

  // --- Seed scenarios with full step attributes ---
  const insertScenario = db.prepare(
    "INSERT INTO t_objectscenarios (Object_ID, Scenario, ScenarioType, XMLContent, Notes, ea_guid) VALUES (?, ?, ?, ?, ?, ?)"
  );
  insertScenario.run(
    1, "Basic Path", "Basic Path",
    '<path><step name="Používateľ otvorí zoznam" level="0" guid="{AAA-111}" trigger="Používateľ" uses="" result="" state="" link="{OBJ-0003}" useslist=""/><step name="Systém zobrazí údaje" level="0" guid="{AAA-222}" trigger="Systém" uses="UC_001" result="Zoznam" state="" link="" useslist="{OBJ-0002}"/></path>',
    "Poznámka k základnému scenáru", "{BP-001}"
  );
  insertScenario.run(
    1, "Alternate 1", "Alternate",
    '<path><step name="Zmluvná strana neexistuje" level="0" guid="{BBB-111}" trigger="" uses="" result="" state="" link="" useslist=""/></path>',
    "Alternatívny scenár", "{ALT-001}"
  );

  // --- Seed constraints (R10) ---
  const insertConstraint = db.prepare(
    `INSERT INTO t_objectconstraint (Object_ID, "Constraint", ConstraintType, Notes, Status) VALUES (?, ?, ?, ?, ?)`
  );
  insertConstraint.run(1, "Spis je v stave uzatvorený", "Pre-condition", "Kontrola stavu spisu", "");
  insertConstraint.run(1, "Pravidlo nastavenia auditovanej činnosti", "Process",
    "Ak pracujeme s objektom, tak zaloguj LOG_ABC_083: ZMENA_STAVU", "");
  // Element with constraint but no scenario (R10/A11 test shape)
  insertConstraint.run(6, "Platná IČO", "Invariant", "Pr&#225;vnick&#225; osoba mus&#237; mať platn&#233; IČO", "");

  return {
    db,
    dbPath,
    cleanup: () => {
      try { db.close(); } catch { /* already closed */ }
      try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}
