import { openDatabase } from "../src/database";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("openDatabase", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ea-test-"));
  });

  it("opens a valid .qea file and returns a DatabaseSync instance", () => {
    const dbPath = join(tempDir, "valid.qea");
    const tmp = new DatabaseSync(dbPath);
    tmp.exec("CREATE TABLE t_object (Object_ID INTEGER PRIMARY KEY, Name TEXT)");
    tmp.exec("INSERT INTO t_object VALUES (1, 'Test')");
    tmp.close();

    const db = openDatabase(dbPath);
    expect(db).toBeInstanceOf(DatabaseSync);
    const row = db.prepare("SELECT Name FROM t_object WHERE Object_ID = 1").get() as any;
    expect(row.Name).toBe("Test");
    db.close();
  });

  it("throws for non-existent file", () => {
    expect(() => openDatabase("/nonexistent/path/to.qea")).toThrow("QEA file not found");
  });

  it("throws for file without t_object table", () => {
    const dbPath = join(tempDir, "no-t_object.qea");
    const tmp = new DatabaseSync(dbPath);
    tmp.exec("CREATE TABLE some_other_table (id INTEGER)");
    tmp.close();

    expect(() => openDatabase(dbPath)).toThrow("not a valid Enterprise Architect export");
  });

  it("throws for non-SQLite file", () => {
    const filePath = join(tempDir, "not-sqlite.qea");
    writeFileSync(filePath, "this is not a database file");

    expect(() => openDatabase(filePath)).toThrow("not a valid Enterprise Architect export");
  });

  afterAll(() => {
    // Cleanup temp files
    try {
      const { readdirSync } = require("node:fs");
      for (const f of readdirSync(tempDir)) {
        unlinkSync(join(tempDir, f));
      }
      require("node:fs").rmdirSync(tempDir);
    } catch {
      // best effort
    }
  });
});
