/**
 * The eval's assertions are claims about this model's contents. If a landmark row
 * moves, every task that depends on it fails at once and the failure looks like a
 * regression in the server. These tests keep that failure local and legible.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { buildEvalModel, type EvalModel } from "../eval/fixture.js";
import { EA_TABLES } from "./helpers/ea-schema.js";

let model: EvalModel;
let db: DatabaseSync;

beforeAll(() => {
  model = buildEvalModel();
  db = new DatabaseSync(model.path, { readOnly: true });
});

afterAll(() => {
  try { db.close(); } catch { /* already closed */ }
  model.cleanup();
});

describe("the eval model", () => {
  it("is a readable database carrying every table the schema declares", () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
      .map((row) => row.name);
    for (const table of EA_TABLES) {
      expect(names).toContain(table);
    }
  });

  it("seeds every table, so no tool answers from an empty one", () => {
    for (const table of EA_TABLES) {
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect({ table, n }).toEqual({ table, n: expect.any(Number) });
      expect(n).toBeGreaterThan(0);
    }
  });
});

describe("the shapes the eval questions depend on", () => {
  it("repeats one element name across two packages", () => {
    const rows = db.prepare("SELECT Object_ID, Package_ID FROM t_object WHERE Name = 'Dodávateľ' ORDER BY Object_ID").all();
    expect(rows).toEqual([
      { Object_ID: 121, Package_ID: 5 },
      { Object_ID: 122, Package_ID: 6 },
    ]);
  });

  it("holds an exact name that is also the prefix of another element", () => {
    const rows = db.prepare("SELECT Object_ID FROM t_object WHERE Name LIKE 'UC_OBS_4101%' ORDER BY Object_ID").all();
    expect(rows).toEqual([{ Object_ID: 101 }, { Object_ID: 103 }]);
  });

  it("stores the accounting-unit note encoded, not as plain text", () => {
    const { Note } = db.prepare("SELECT Note FROM t_object WHERE Object_ID = 123").get() as { Note: string };
    expect(Note).toContain("z&#225;v&#228;zok");
    expect(Note).not.toContain("záväzok");
  });

  it("maps screen fields to entity attributes through StyleEx feature links", () => {
    const rows = db.prepare(
      "SELECT Connector_ID, StyleEx FROM t_connector WHERE StyleEx LIKE 'LFSP=%' AND StyleEx LIKE '%LFEP=%' ORDER BY Connector_ID"
    ).all() as { Connector_ID: number; StyleEx: string }[];
    expect(rows).toHaveLength(3);
    expect(rows[0].StyleEx).toBe("LFSP={EVAL-ATTR-0201}L;LFEP={EVAL-ATTR-0210}R;");
  });

  it("cites a process rule from a scenario step whose text lives in the constraints", () => {
    const { XMLContent } = db.prepare(
      "SELECT XMLContent FROM t_objectscenarios WHERE Object_ID = 101 AND Scenario = 'Basic Path'"
    ).get() as { XMLContent: string };
    expect(XMLContent).toContain('uses="PRAV_OBS_8501"');

    const rule = db.prepare(
      `SELECT "Constraint" AS name FROM t_objectconstraint WHERE Object_ID = 101 AND "Constraint" = 'PRAV_OBS_8501'`
    ).get();
    expect(rule).toEqual({ name: "PRAV_OBS_8501" });
  });

  it("gives one element more attributes than fit inline", () => {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM t_attribute WHERE Object_ID = 150").get() as { n: number };
    expect(n).toBe(60);
  });

  it("contrasts uniform and mixed attribute multiplicity across two elements", () => {
    const spread = (objectId: number) =>
      new Set(
        (db.prepare("SELECT LowerBound, UpperBound FROM t_attribute WHERE Object_ID = ?")
          .all(objectId) as { LowerBound: string; UpperBound: string }[])
          .map((a) => `${a.LowerBound}..${a.UpperBound}`)
      ).size;

    expect(spread(120)).toBeGreaterThan(1);
    expect(spread(121)).toBe(1);
  });

  it("leaves one diagram connector implied, with no link row", () => {
    const linked = db.prepare("SELECT ConnectorID FROM t_diagramlinks WHERE DiagramID = 602").all();
    expect(linked).toEqual([]);
  });
});

describe("cleanup", () => {
  it("removes the directory it built", () => {
    const scratch = buildEvalModel();
    const dir = dirname(scratch.path);
    expect(existsSync(scratch.path)).toBe(true);
    scratch.cleanup();
    expect(existsSync(dir)).toBe(false);
  });
});
