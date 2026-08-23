/**
 * The model the eval runs against.
 *
 * Unlike the unit fixture, this one is built to make a *wrong tool chain* produce a
 * wrong answer rather than a merely thin one. Five shapes carry that weight:
 *
 *  1. A screen field is mapped to an entity attribute only through `StyleEx` feature
 *     links, so the mapping is unreachable without reading connectors.
 *  2. `Dodávateľ` and `UC_OBS_4101` each exist in two packages, so a resolution that
 *     ignores the package path picks one at random.
 *  3. A scenario step cites a process rule by name; the rule's text lives in the
 *     element's constraints, so answering needs a second lookup.
 *  4. `ÚČTOVNÁ JEDNOTKA` stores its note entity-encoded, so a search that does not
 *     decode finds nothing.
 *  5. `Sadzobník poplatkov` carries more attributes than fit inline, so a count taken
 *     from the inline list is wrong.
 *
 * Names are deliberately different from `test/helpers/test-db.ts`: the two fixtures
 * share a domain so the repo reads consistently, but a cross-wired import must fail
 * loudly instead of half-passing.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EA_SCHEMA } from "../test/helpers/ea-schema.js";

export interface EvalModel {
  /** Path to the built .qea file. */
  path: string;
  cleanup: () => void;
}

/** Attributes of `Sadzobník poplatkov`, enough to exceed the 50-item inline cap. */
const TARIFF_ITEM_COUNT = 60;

export function buildEvalModel(): EvalModel {
  const dir = mkdtempSync(join(tmpdir(), "ea-eval-"));
  const path = join(dir, "eval-model.qea");
  const db = new DatabaseSync(path);

  db.exec(EA_SCHEMA);

  const pkg = db.prepare(
    "INSERT INTO t_package (Package_ID, Name, Parent_ID, ea_guid, TPos) VALUES (?, ?, ?, ?, ?)"
  );
  pkg.run(1, "Model", 0, "{EVAL-PKG-0001}", 0);
  pkg.run(2, "Obchodná analýza", 1, "{EVAL-PKG-0002}", 0);
  pkg.run(3, "Prípady použitia", 2, "{EVAL-PKG-0003}", 0);
  pkg.run(4, "Obrazovky", 2, "{EVAL-PKG-0004}", 1);
  pkg.run(5, "Doménový model", 2, "{EVAL-PKG-0005}", 2);
  pkg.run(6, "Aplikačná architektúra", 1, "{EVAL-PKG-0006}", 1);
  pkg.run(7, "Prípady použitia", 6, "{EVAL-PKG-0007}", 0); // same name as package 3
  pkg.run(8, "Číselníky", 5, "{EVAL-PKG-0008}", 0);

  const obj = db.prepare(
    `INSERT INTO t_object (Object_ID, Object_Type, Name, Alias, Stereotype, Package_ID, Note, Status, Author, ea_guid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  obj.run(101, "UseCase", "UC_OBS_4101: Založenie zmluvy", "UC4101", "UseCase", 3,
    "Založenie novej zmluvy s dodávateľom vrátane kontroly registra.", "Approved", "analytik", "{EVAL-OBJ-0101}");
  obj.run(102, "UseCase", "UC_OBS_4102: Ukončenie zmluvy", null, "UseCase", 3,
    "Ukončenie platnej zmluvy k zadanému dátumu.", "Approved", "analytik", "{EVAL-OBJ-0102}");
  // Exact name of the prefix used by 101, in the other "Prípady použitia" package.
  obj.run(103, "UseCase", "UC_OBS_4101", null, "UseCase", 7,
    "Realizačný pohľad na založenie zmluvy.", "Proposed", "architekt", "{EVAL-OBJ-0103}");

  obj.run(110, "Screen", "OBR_OBS_5201: Detail zmluvy", null, "Obrazovka", 4,
    "Obrazovka s detailom jednej zmluvy.", "Approved", "analytik", "{EVAL-OBJ-0110}");
  obj.run(111, "Screen", "OBR_OBS_5202: Zoznam dodávateľov", null, "Obrazovka", 4,
    "Prehľad dodávateľov s možnosťou filtrovania.", "Approved", "analytik", "{EVAL-OBJ-0111}");

  obj.run(120, "Class", "Zmluva", null, "Entity", 5,
    "Zmluvný vzťah medzi objednávateľom a dodávateľom.", "Approved", "analytik", "{EVAL-OBJ-0120}");
  obj.run(121, "Class", "Dodávateľ", null, "Entity", 5,
    "Dodávateľ ako zmluvná strana.", "Approved", "analytik", "{EVAL-OBJ-0121}");
  // Same name, different package: resolution must disambiguate by path.
  obj.run(122, "Class", "Dodávateľ", null, "Entity", 6,
    "Dodávateľ v aplikačnom pohľade.", "Proposed", "architekt", "{EVAL-OBJ-0122}");
  // The note is stored entity-encoded; "záväzok" is reachable only after decoding.
  obj.run(123, "Class", "ÚČTOVNÁ JEDNOTKA", null, "Entity", 5,
    "&#218;čtovn&#225; jednotka eviduje z&#225;v&#228;zok z uzavret&#253;ch zml&#250;v (&lt;&lt;dom&#233;na&gt;&gt;).",
    "Approved", "analytik", "{EVAL-OBJ-0123}");
  obj.run(124, "Class", "Číselník stavov zmluvy", null, "Enumeration", 8,
    "&#268;íseln&#237;k stavov: N&#225;vrh, Platn&#225;, Ukon&#269;en&#225;.", "Approved", "analytik", "{EVAL-OBJ-0124}");

  obj.run(130, "Requirement", "POZ_OBS_6301: Evidencia dodatkov", null, null, 3,
    `Systém eviduje dodatky k zmluve. ${"Dodatok mení dohodnuté podmienky zmluvy. ".repeat(8)}`,
    "Proposed", "analytik", "{EVAL-OBJ-0130}");

  obj.run(140, "Component", "Modul zmlúv", null, null, 6,
    "Aplikačný komponent spravujúci zmluvy.", "Approved", "architekt", "{EVAL-OBJ-0140}");
  obj.run(141, "Interface", "IZmluvaService", null, null, 6,
    "Rozhranie pre operácie nad zmluvou.", "Approved", "architekt", "{EVAL-OBJ-0141}");

  obj.run(150, "Class", "Sadzobník poplatkov", null, "Entity", 8,
    "Položky sadzobníka poplatkov.", "Approved", "analytik", "{EVAL-OBJ-0150}");

  const attr = db.prepare(
    `INSERT INTO t_attribute (ID, Object_ID, Name, Type, Scope, Stereotype, Notes, LowerBound, UpperBound, "Default", Pos, ea_guid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Screen fields — the left-hand side of the mapping.
  attr.run(201, 110, "poleCisloZmluvy", "String", "Public", "Pole", "Pole s číslom zmluvy", "1", "1", null, 0, "{EVAL-ATTR-0201}");
  attr.run(202, 110, "poleCelkovaCena", "String", "Public", "Pole", "Pole s celkovou cenou", "0", "1", null, 1, "{EVAL-ATTR-0202}");
  attr.run(203, 110, "poleStavZmluvy", "String", "Public", "Pole", "Pole so stavom zmluvy", "1", "1", null, 2, "{EVAL-ATTR-0203}");
  // Entity attributes — the right-hand side. Mixed multiplicity, so the contrast is real.
  attr.run(210, 120, "cisloZmluvy", "String", "Public", null, "Jednoznačné číslo zmluvy", "1", "1", null, 0, "{EVAL-ATTR-0210}");
  attr.run(211, 120, "datumUcinnosti", "Date", "Public", null, "Dátum účinnosti zmluvy", "1", "1", null, 1, "{EVAL-ATTR-0211}");
  attr.run(212, 120, "celkovaCena", "Decimal", "Public", null, "Celková cena bez DPH", "0", "1", null, 2, "{EVAL-ATTR-0212}");
  attr.run(213, 120, "stavZmluvy", "String", "Public", null, "Stav podľa číselníka", "1", "1", "Návrh", 3, "{EVAL-ATTR-0213}");
  // Uniform multiplicity, so multiplicityIsUniform contrasts with Zmluva.
  attr.run(220, 121, "obchodneMeno", "String", "Public", null, "Obchodné meno dodávateľa", "1", "1", null, 0, "{EVAL-ATTR-0220}");
  attr.run(221, 121, "ico", "String", "Public", null, "Identifikačné číslo organizácie", "1", "1", null, 1, "{EVAL-ATTR-0221}");
  attr.run(222, 121, "sidlo", "String", "Public", null, "Adresa sídla", "1", "1", null, 2, "{EVAL-ATTR-0222}");
  attr.run(230, 123, "názov", "String", "Public", null, "N&#225;zov účtovnej jednotky", "1", "1", null, 0, "{EVAL-ATTR-0230}");

  for (let i = 1; i <= TARIFF_ITEM_COUNT; i++) {
    const id = 300 + i;
    attr.run(id, 150, `polozka${String(i).padStart(2, "0")}`, "Decimal", "Public", null,
      `Poplatok číslo ${i}`, "1", "1", null, i - 1, `{EVAL-ATTR-${id}}`);
  }

  const op = db.prepare(
    "INSERT INTO t_operation (OperationID, Object_ID, Name, Type, Scope, Stereotype, Notes, Pos, ea_guid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  op.run(401, 141, "zalozZmluvu", "Zmluva", "Public", null, "Založí zmluvu pre dodávateľa", 0, "{EVAL-OP-0401}");
  op.run(402, 141, "ukonciZmluvu", "void", "Public", null, "Ukončí zmluvu k dátumu", 1, "{EVAL-OP-0402}");

  const param = db.prepare(
    "INSERT INTO t_operationparams (OperationID, Name, Type, Kind, Notes, Pos) VALUES (?, ?, ?, ?, ?, ?)"
  );
  param.run(401, "dodavatelId", "Long", "in", "Identifikátor dodávateľa", 0);
  param.run(401, "cisloZmluvy", "String", "in", "Číslo novej zmluvy", 1);
  param.run(402, "zmluvaId", "Long", "in", "Identifikátor zmluvy", 0);

  const conn = db.prepare(
    `INSERT INTO t_connector (Connector_ID, Connector_Type, SubType, Name, Direction, Stereotype, Notes, SourceCard, DestCard, Start_Object_ID, End_Object_ID, SourceRole, DestRole, StyleEx)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Field-to-attribute mapping: only StyleEx says which field fills which attribute.
  conn.run(501, "Realisation", null, null, "Source -> Destination", null, null, null, null, 110, 120,
    null, null, "LFSP={EVAL-ATTR-0201}L;LFEP={EVAL-ATTR-0210}R;");
  conn.run(502, "Realisation", null, null, "Source -> Destination", null, null, null, null, 110, 120,
    null, null, "LFSP={EVAL-ATTR-0202}L;LFEP={EVAL-ATTR-0212}R;");
  conn.run(503, "Realisation", null, null, "Source -> Destination", null, null, null, null, 110, 120,
    null, null, "LFSP={EVAL-ATTR-0203}L;LFEP={EVAL-ATTR-0213}R;");
  conn.run(504, "Association", null, "spravuje", "Source -> Destination", null, null, "1", "*", 101, 120,
    "Správca zmlúv", "Zmluva", null);
  conn.run(505, "Dependency", null, null, "Source -> Destination", null, null, null, null, 140, 141,
    null, null, null);
  conn.run(506, "Association", null, "má dodávateľa", "Source -> Destination", null, null, "*", "1", 120, 121,
    null, "Dodávateľ", null);
  // Feature link to an operation rather than an attribute.
  conn.run(507, "Dependency", null, null, "Source -> Destination", null, null, null, null, 141, 120,
    null, null, "LFSP={EVAL-OP-0401}L;");
  conn.run(508, "Realisation", null, null, "Source -> Destination", null, null, null, null, 103, 101,
    null, null, null);

  const diag = db.prepare(
    "INSERT INTO t_diagram (Diagram_ID, Name, Diagram_Type, Package_ID, Notes, ea_guid) VALUES (?, ?, ?, ?, ?, ?)"
  );
  diag.run(601, "DG_OBS_7401: Životný cyklus zmluvy", "Use Case", 3, "Prípady použitia nad zmluvou", "{EVAL-DIAG-0601}");
  diag.run(602, "DG_OBS_7402: Doménový model zmluvy", "Class", 5, "Entity zmluvnej domény", "{EVAL-DIAG-0602}");
  diag.run(603, "DG_OBS_7401: Životný cyklus zmluvy", "Use Case", 7, "Rovnaký názov v inom balíku", "{EVAL-DIAG-0603}");

  const diagObj = db.prepare(
    "INSERT INTO t_diagramobjects (Diagram_ID, Object_ID, Sequence) VALUES (?, ?, ?)"
  );
  diagObj.run(601, 101, 1);
  diagObj.run(601, 102, 2);
  diagObj.run(601, 110, 3);
  diagObj.run(602, 120, 1);
  diagObj.run(602, 121, 2);
  diagObj.run(602, 123, 3);
  diagObj.run(603, 103, 1);

  const diagLink = db.prepare(
    "INSERT INTO t_diagramlinks (DiagramID, ConnectorID, Hidden) VALUES (?, ?, ?)"
  );
  diagLink.run(601, 504, 0);
  // Connector 506 joins two elements both on diagram 602 with no row here: implied.
  diagLink.run(603, 508, 1);

  db.prepare(
    "INSERT INTO t_objectscenarios (Object_ID, Scenario, ScenarioType, XMLContent, Notes, ea_guid) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    101, "Basic Path", "Basic Path",
    '<path>' +
      '<step name="Používateľ vyplní údaje zmluvy" level="0" guid="{EVAL-STEP-0001}" trigger="Používateľ" uses="" result="" state="" link="{EVAL-OBJ-0110}" useslist=""/>' +
      '<step name="Systém overí pravidlo PRAV_OBS_8501" level="0" guid="{EVAL-STEP-0002}" trigger="Systém" uses="PRAV_OBS_8501" result="" state="" link="" useslist="{EVAL-OBJ-0120}"/>' +
      '<step name="Systém uloží zmluvu" level="0" guid="{EVAL-STEP-0003}" trigger="Systém" uses="" result="Zmluva je založená" state="" link="" useslist=""/>' +
    '</path>',
    "Základný scenár založenia zmluvy", "{EVAL-SCN-0001}"
  );
  db.prepare(
    "INSERT INTO t_objectscenarios (Object_ID, Scenario, ScenarioType, XMLContent, Notes, ea_guid) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    101, "Alternate 1", "Alternate",
    '<path><step name="Dodávateľ nie je v registri" level="0" guid="{EVAL-STEP-0011}" trigger="Systém" uses="" result="Zmluva sa nezaloží" state="" link="" useslist=""/></path>',
    "Dodávateľ chýba v registri", "{EVAL-SCN-0002}"
  );

  const constraint = db.prepare(
    `INSERT INTO t_objectconstraint (Object_ID, "Constraint", ConstraintType, Notes, Status) VALUES (?, ?, ?, ?, ?)`
  );
  // The rule the Basic Path step cites by name; its text lives only here.
  constraint.run(101, "PRAV_OBS_8501", "Process",
    "Dátum účinnosti zmluvy nesmie byť skorší ako dátum jej založenia.", "Approved");
  constraint.run(101, "Používateľ má rolu Správca zmlúv", "Pre-condition", "Kontrola oprávnenia.", "Approved");
  constraint.run(101, "Zmluva je v stave Návrh", "Post-condition", "Stav po úspešnom založení.", "Approved");
  constraint.run(123, "Platné IČO", "Invariant",
    "&#218;čtovn&#225; jednotka mus&#237; mať platn&#233; I&#268;O.", "Approved");

  db.close();

  return {
    path,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}
