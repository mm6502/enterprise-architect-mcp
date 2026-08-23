import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPackagePath } from "../src/package-path";

let db: DatabaseSync;
let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ea-pkg-path-"));
  const dbPath = join(tempDir, "pkg-test.qea");
  db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE t_package (Package_ID INTEGER PRIMARY KEY, Name TEXT, Parent_ID INTEGER DEFAULT 0);
    INSERT INTO t_package VALUES (1, 'Model', 0);
    INSERT INTO t_package VALUES (2, 'Analýza', 1);
    INSERT INTO t_package VALUES (3, 'Use Cases', 2);
  `);
});

afterAll(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("buildPackagePath", () => {
  it("returns just name for root package", () => {
    expect(buildPackagePath(db, 1)).toBe("Model");
  });

  it("returns full dot-separated path for nested package", () => {
    expect(buildPackagePath(db, 3)).toBe("Model.Analýza.Use Cases");
  });

  it("caches results across calls", () => {
    const first = buildPackagePath(db, 3);
    const second = buildPackagePath(db, 3);
    expect(first).toBe(second);
  });
});
