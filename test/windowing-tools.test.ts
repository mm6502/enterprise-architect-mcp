/**
 * Behaviour tests for the enumeration window: deterministic order, offset paging,
 * and the breakdown that fires when a set is too large to walk.
 *
 * These build their own bulk rows on top of the shared fixture rather than growing it,
 * because the other suites assert exact counts over the fixture's small packages.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { configureAllTools } from "../src/tools";
import { createTestDb, staticModel, TestDb } from "./helpers/test-db";

let client: Client;
let server: McpServer;
let testDb: TestDb;

const PAGING_PACKAGE = 7;
const UNIFORM_PACKAGE = 8;
const SCOPE_PACKAGE = 9;
const BULK_TYPES = ["Class", "UseCase", "Screen"];
const DIAGRAM_TYPES = ["Logical", "Use Case", "Sequence"];

/** Names whose initial SQLite's binary collation sorts after every unaccented letter. */
const ACCENTED_FIRST = ["Žiadosť o výpis", "Álava register", "Údaje o osobe"];

beforeAll(async () => {
  testDb = createTestDb();
  const db = testDb.db;

  db.prepare("INSERT INTO t_package (Package_ID, Name, Parent_ID, ea_guid, TPos) VALUES (?, ?, ?, ?, ?)")
    .run(PAGING_PACKAGE, "Paging", 1, "{PKG-0007}", 2);

  db.prepare("INSERT INTO t_package (Package_ID, Name, Parent_ID, ea_guid, TPos) VALUES (?, ?, ?, ?, ?)")
    .run(UNIFORM_PACKAGE, "Uniform", 1, "{PKG-0008}", 3);

  db.prepare("INSERT INTO t_package (Package_ID, Name, Parent_ID, ea_guid, TPos) VALUES (?, ?, ?, ?, ?)")
    .run(SCOPE_PACKAGE, "Scope target", 1, "{PKG-0009}", 4);

  const insertObj = db.prepare(
    `INSERT INTO t_object (Object_ID, Object_Type, Name, Alias, Stereotype, Package_ID, Note, Status, Author, ea_guid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Accented initials get the lowest identities, so they sit in the first window under
  // identity order and would be exiled past every plain letter under binary name order.
  ACCENTED_FIRST.forEach((name, i) => {
    insertObj.run(1000 + i, "Class", name, null, "Entity", PAGING_PACKAGE, null, "Approved", "admin", `{BULK-${1000 + i}}`);
  });

  // One type only, so the sole axis has nothing to distinguish and the breakdown collapses.
  for (let i = 0; i < 12; i++) {
    const id = 1200 + i;
    insertObj.run(id, "Class", `Uniform element ${i}`, null, null, UNIFORM_PACKAGE, null, "Approved", "admin", `{UNI-${id}}`);
  }

  // Split evenly across two packages, so the package breakdown axis has something to report.
  for (let i = 0; i < 6; i++) {
    insertObj.run(1300 + i, "Class", `Scopeterm A${i}`, null, null, PAGING_PACKAGE, null, "Approved", "admin", `{SCOPE-A-${1300 + i}}`);
    insertObj.run(1310 + i, "Class", `Scopeterm B${i}`, null, null, SCOPE_PACKAGE, null, "Approved", "admin", `{SCOPE-B-${1310 + i}}`);
  }

  for (let i = 0; i < 57; i++) {
    const id = 1100 + i;
    insertObj.run(
      id,
      BULK_TYPES[i % BULK_TYPES.length],
      `Bulk element ${String(i).padStart(3, "0")}`,
      null,
      i % 2 === 0 ? "Entity" : "Boundary",
      PAGING_PACKAGE,
      null,
      "Approved",
      "admin",
      `{BULK-${id}}`
    );
  }

  const insertDiagram = db.prepare(
    "INSERT INTO t_diagram (Diagram_ID, Package_ID, Name, Diagram_Type, ea_guid, Notes) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (let i = 0; i < 60; i++) {
    const id = 1000 + i;
    insertDiagram.run(id, PAGING_PACKAGE, `Bulk diagram ${String(i).padStart(3, "0")}`, DIAGRAM_TYPES[i % DIAGRAM_TYPES.length], `{BULKDGM-${id}}`, null);
  }

  // Relevance ladder shapes for the query "stav".
  const rank: [number, string, string | null][] = [
    [2000, "Stav", null],
    [2001, "Stavy zmluvy", null],
    [2002, "Zoznam stavov", null],
    [2003, "Prestavba objektu", null],
    [2004, "Objekt bez zhody v názve", "Poznámka spomínajúca stav objektu"],
  ];
  for (const [id, name, note] of rank) {
    insertObj.run(id, "Class", name, null, null, PAGING_PACKAGE, note, "Approved", "admin", `{RANK-${id}}`);
  }

  // Identical names at the same rank and coverage: only identity can separate them.
  insertObj.run(2011, "Class", "Stav duplicitný", null, null, PAGING_PACKAGE, null, "Approved", "admin", "{RANK-2011}");
  insertObj.run(2010, "Class", "Stav duplicitný", null, null, PAGING_PACKAGE, null, "Approved", "admin", "{RANK-2010}");

  // One object carrying the query in two feature tables at once.
  insertObj.run(2020, "Class", "Nositeľ vlastností", null, null, PAGING_PACKAGE, null, "Approved", "admin", "{RANK-2020}");
  db.prepare(
    `INSERT INTO t_attribute (ID, Object_ID, Name, Type, Scope, Stereotype, Notes, LowerBound, UpperBound, "Default", Pos, ea_guid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(500, 2020, "stavPolozky", "String", "Public", null, null, "1", "1", null, 0, "{ATTR-0500}");
  db.prepare(
    "INSERT INTO t_operation (OperationID, Object_ID, Name, Type, Scope, Stereotype, Notes, Pos, ea_guid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(500, 2020, "prepocitaj", "void", "Public", null, "Prepočíta stav položky", 0, "{OP-0500}");

  server = new McpServer({ name: "Windowing Behaviour", version: "0.0.0" });
  configureAllTools(server, staticModel(db));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
  testDb.cleanup();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  return JSON.parse((result.content as any[])[0]?.text);
}

/** Follows continuation to exhaustion, returning every row seen in order. */
async function walk(tool: string, args: Record<string, unknown>, collection: string) {
  const seen: any[] = [];
  let next: Record<string, unknown> | undefined = args;

  for (let guard = 0; next && guard < 200; guard++) {
    const body: any = await call(tool, next);
    seen.push(...body[collection]);
    next = body.continuation?.arguments;
    if (!next) {
      expect(body.truncated).toBe(false);
      break;
    }
    expect(body.truncated).toBe(true);
  }
  return seen;
}

describe("ea_list_elements windowing", () => {
  it("returns the same rows in the same positions on repeated calls", async () => {
    const a = await call("ea_list_elements", { packageId: PAGING_PACKAGE, limit: 10 });
    const b = await call("ea_list_elements", { packageId: PAGING_PACKAGE, limit: 10 });
    expect(a.elements).toEqual(b.elements);

    const filteredA = await call("ea_list_elements", { packageId: PAGING_PACKAGE, objectType: "Class", limit: 10, offset: 5 });
    const filteredB = await call("ea_list_elements", { packageId: PAGING_PACKAGE, objectType: "Class", limit: 10, offset: 5 });
    expect(filteredA.elements).toEqual(filteredB.elements);
  });

  it("shows accented initials in the first window instead of exiling them past Z", async () => {
    const body = await call("ea_list_elements", { packageId: PAGING_PACKAGE, objectType: "Class", limit: 5 });
    const names = body.elements.map((e: any) => e.Name);
    expect(names).toEqual(expect.arrayContaining(ACCENTED_FIRST));
  });

  it("walks the whole package by continuation with no repeats and no gaps", async () => {
    const total = (await call("ea_list_elements", { packageId: PAGING_PACKAGE, limit: 1 })).totalMatched;
    const seen = await walk("ea_list_elements", { packageId: PAGING_PACKAGE, limit: 7 }, "elements");

    const ids = seen.map((e) => e.Object_ID);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
  });

  it("echoes offset and reports position in the set", async () => {
    const body = await call("ea_list_elements", { packageId: PAGING_PACKAGE, limit: 10, offset: 10 });
    expect(body.offset).toBe(10);
    expect(body.returned).toBe(10);
    expect(body.truncated).toBe(body.offset + body.returned < body.totalMatched);
  });

  it("returns an empty window past the end rather than an error", async () => {
    const body = await call("ea_list_elements", { packageId: PAGING_PACKAGE, limit: 10, offset: 100000 });
    expect(body.elements).toEqual([]);
    expect(body.truncated).toBe(false);
    expect(body.continuation).toBeUndefined();
  });

  it("omits breakdown below the threshold", async () => {
    const body = await call("ea_list_elements", { packageId: PAGING_PACKAGE, limit: 50 });
    expect(body.breakdown).toBeUndefined();
  });

  it("reports a breakdown whose keys work as objectType arguments", async () => {
    const body = await call("ea_list_elements", { packageId: PAGING_PACKAGE, limit: 5 });
    const axis = body.breakdown.objectType;

    const summed = axis.values.reduce((n: number, v: any) => n + v.count, 0);
    expect(summed).toBe(body.totalMatched);

    for (const { value, count } of axis.values) {
      const narrowed = await call("ea_list_elements", { packageId: PAGING_PACKAGE, objectType: value, limit: 5 });
      expect(narrowed.totalMatched).toBe(count);
    }
  });

  it("omits the objectType axis once objectType is supplied", async () => {
    const body = await call("ea_list_elements", { packageId: PAGING_PACKAGE, objectType: "Class", limit: 1 });
    expect(body.breakdown).toBeUndefined();
  });

  it("omits breakdown entirely when the only axis has nothing to distinguish", async () => {
    const body = await call("ea_list_elements", { packageId: UNIFORM_PACKAGE, limit: 1 });
    // The threshold trips, so silence here is the collapse, not an untriggered breakdown.
    expect(body.totalMatched).toBeGreaterThan(10);
    expect(body.truncated).toBe(true);
    expect(body.continuation).toBeDefined();
    expect("breakdown" in body).toBe(false);
  });
});

describe("ea_list_diagrams windowing", () => {
  it("returns a repeatable order for the unfiltered listing", async () => {
    const a = await call("ea_list_diagrams", { limit: 20 });
    const b = await call("ea_list_diagrams", { limit: 20 });
    expect(a.results).toEqual(b.results);
    expect(a.results.map((r: any) => r.diagramId)).toEqual([...a.results.map((r: any) => r.diagramId)].sort((x, y) => x - y));
  });

  it("filters by diagramType, alone and combined with nameContains", async () => {
    const typed = await call("ea_list_diagrams", { packageId: PAGING_PACKAGE, diagramType: "Sequence", limit: 100 });
    expect(typed.totalMatched).toBe(20);
    expect(typed.results.every((r: any) => r.type === "Sequence")).toBe(true);

    const both = await call("ea_list_diagrams", { packageId: PAGING_PACKAGE, diagramType: "Sequence", nameContains: "diagram 00", limit: 100 });
    expect(both.totalMatched).toBeLessThan(typed.totalMatched);
    expect(both.results.every((r: any) => r.type === "Sequence" && r.name.includes("diagram 00"))).toBe(true);
  });

  it("walks a name-filtered set exactly once", async () => {
    const total = (await call("ea_list_diagrams", { nameContains: "Bulk diagram", limit: 1 })).totalMatched;
    const seen = await walk("ea_list_diagrams", { nameContains: "Bulk diagram", limit: 9 }, "results");

    const ids = seen.map((d) => d.diagramId);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
  });

  it("adds a breakdown without disturbing the window", async () => {
    const body = await call("ea_list_diagrams", { packageId: PAGING_PACKAGE, limit: 5 });
    expect(body.returned).toBe(5);
    expect(body.results).toHaveLength(5);

    const axis = body.breakdown.diagramType;
    expect(axis.values.map((v: any) => v.value).sort()).toEqual([...DIAGRAM_TYPES].sort());

    const narrowed = await call("ea_list_diagrams", { packageId: PAGING_PACKAGE, diagramType: axis.values[0].value, limit: 5 });
    expect(narrowed.totalMatched).toBe(axis.values[0].count);
  });

  it("describes the unfiltered listing, which is the call that shows 0.5% of the model", async () => {
    const body = await call("ea_list_diagrams", { limit: 5 });
    expect(body.returned).toBe(5);
    expect(body.breakdown.diagramType.values.length).toBeGreaterThan(1);

    const first = body.breakdown.diagramType.values[0];
    const narrowed = await call("ea_list_diagrams", { diagramType: first.value, limit: 5 });
    expect(narrowed.totalMatched).toBe(first.count);
  });

  it("still reports a missing package as a structured not-found error", async () => {
    const result = await client.callTool({ name: "ea_list_diagrams", arguments: { packageId: 999999 } });
    expect((result as any).isError).toBe(true);
    expect(JSON.parse((result.content as any[])[0].text).error).toBe("not_found");
  });
});

describe("ea_search relevance ladder", () => {
  const nameOrder = async () => {
    const body = await call("ea_search", { query: "stav", limit: 50 });
    return body.results.map((r: any) => r.Name);
  };

  it("ranks exact, then prefix, then word boundary, then interior", async () => {
    const names = await nameOrder();
    const at = (n: string) => names.indexOf(n);

    expect(at("Stav")).toBe(0);
    expect(at("Stavy zmluvy")).toBeLessThan(at("Zoznam stavov"));
    expect(at("Zoznam stavov")).toBeLessThan(at("Prestavba objektu"));
  });

  it("prefers the name match over a note match", async () => {
    const names = await nameOrder();
    expect(names.indexOf("Prestavba objektu")).toBeLessThan(names.indexOf("Objekt bez zhody v názve"));
  });

  it("puts the shorter name first when rank ties", async () => {
    const names = await nameOrder();
    expect(names.indexOf("Stavy zmluvy")).toBeLessThan(names.indexOf("Stav duplicitný"));
  });

  it("breaks a full tie by identity, repeatably", async () => {
    const body = await call("ea_search", { query: "stav duplicitný", limit: 10 });
    const ids = body.results.map((r: any) => r.Object_ID);
    expect(ids.slice(0, 2)).toEqual([2010, 2011]);

    const again = await call("ea_search", { query: "stav duplicitný", limit: 10 });
    expect(again.results.map((r: any) => r.Object_ID)).toEqual(ids);
  });

  it("reports a stable matchedIn for an object matching in two feature tables", async () => {
    const body = await call("ea_search", { query: "stav", limit: 50 });
    const carrier = body.results.find((r: any) => r.Object_ID === 2020);
    expect(carrier.matchedIn).toBe("t_attribute.Name");
  });

  it("walks a multi-page result exactly once and terminates", async () => {
    const total = (await call("ea_search", { query: "stav", limit: 1 })).totalMatched;
    const seen = await walk("ea_search", { query: "stav", limit: 2 }, "results");

    const ids = seen.map((r) => r.Object_ID);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
  });

  it("describes a hopelessly broad query instead of only sampling it", async () => {
    const body = await call("ea_search", { query: "bulk element", limit: 5 });
    expect(body.totalMatched).toBeGreaterThan(50);

    const summed = body.breakdown.objectType.values.reduce((n: number, v: any) => n + v.count, 0);
    expect(summed).toBe(body.totalMatched);

    const narrowed = await call("ea_search", { query: "bulk element", objectType: "Screen", limit: 5 });
    const screens = body.breakdown.objectType.values.find((v: any) => v.value === "Screen");
    expect(narrowed.totalMatched).toBe(screens.count);
  });

  it("drops the axis the caller already narrowed by, and keeps the one still open", async () => {
    const body = await call("ea_search", { query: "bulk element", objectType: "Class", limit: 1 });
    expect(body.totalMatched).toBeGreaterThan(10);
    // Restating objectType would only offer the filter already in force.
    expect(body.breakdown.objectType).toBeUndefined();
    expect(body.breakdown.stereotype.values.length).toBeGreaterThan(1);
  });

  it("keeps the empty and no-match branches free of window extras", async () => {
    for (const query of ["xyzzy_nonexistent_term_12345", "   "]) {
      const body = await call("ea_search", { query });
      expect(body).toMatchObject({ totalMatched: 0, returned: 0, offset: 0, truncated: false });
      expect(body.breakdown).toBeUndefined();
      expect(body.continuation).toBeUndefined();
    }
  });

  it("reports a package axis whose values narrow with packageScope", async () => {
    const body = await call("ea_search", { query: "scopeterm", limit: 1 });
    expect(body.totalMatched).toBe(12);

    const axis = body.breakdown.packageScope;
    const summed = axis.values.reduce((n: number, v: any) => n + v.count, 0);
    expect(summed).toBe(body.totalMatched);

    for (const { value, count } of axis.values) {
      const narrowed = await call("ea_search", { query: "scopeterm", packageScope: Number(value), limit: 1 });
      expect(narrowed.totalMatched).toBe(count);
    }
  });

  it("omits the packageScope axis once a scope is already given", async () => {
    const body = await call("ea_search", { query: "scopeterm", packageScope: SCOPE_PACKAGE, limit: 1 });
    expect(body.totalMatched).toBe(6);
    expect(body.breakdown?.packageScope).toBeUndefined();
  });

  it("refuses a window that could never advance", async () => {
    const result = await client.callTool({ name: "ea_search", arguments: { query: "stav", limit: 0 } });
    expect((result as any).isError).toBe(true);
  });
});
