/**
 * The path chain is the first thing every user meets, and most of it only runs when
 * something is wrong: a stale remembered path, a placeholder left in an env var, a
 * typo typed into the prompt. These tests drive a real server over a real transport
 * so the elicitation round trip is exercised, not simulated.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ModelSession } from "../src/model-session";
import { configureAllTools } from "../src/tools";
import { listQeaPathCandidates } from "../src/resolve-qea-path";
import { forgetPath, readRememberedPath, rememberPath } from "../src/remembered-path";
import { createTestDb, TestDb } from "./helpers/test-db";

const MISSING = join(tmpdir(), "ea-does-not-exist", "model.qea");

let testDb: TestDb;
let sandbox: string;
let notAModel: string;
let originalCwd: string;
const configDirs: string[] = [];
const originalQeaPath = process.env.EA_QEA_PATH;

beforeAll(() => {
  testDb = createTestDb();
  originalCwd = process.cwd();
  // The chain reads .env from the working directory, so tests must not run in a
  // repo checkout where a developer's own .env would join the candidate list.
  sandbox = mkdtempSync(join(tmpdir(), "ea-session-"));
  notAModel = join(sandbox, "junk.qea");
  writeFileSync(notAModel, "not a database");
  process.chdir(sandbox);
});

afterAll(() => {
  process.chdir(originalCwd);
  testDb.cleanup();
  rmSync(sandbox, { recursive: true, force: true });
  for (const dir of configDirs) rmSync(dir, { recursive: true, force: true });
  delete process.env.EA_MCP_CONFIG_DIR;
  if (originalQeaPath === undefined) delete process.env.EA_QEA_PATH;
  else process.env.EA_QEA_PATH = originalQeaPath;
});

beforeEach(() => {
  delete process.env.EA_QEA_PATH;
  const configDir = mkdtempSync(join(tmpdir(), "ea-config-"));
  configDirs.push(configDir);
  process.env.EA_MCP_CONFIG_DIR = configDir;
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface Harness {
  session: ModelSession;
  prompts: string[];
  close: () => Promise<void>;
}

/** Answers are consumed in order; `null` means the user dismissed the prompt. */
async function harness(
  answers: (string | null)[],
  options: { cliArg?: string; canElicit?: boolean } = {}
): Promise<Harness> {
  const { cliArg, canElicit = true } = options;
  const prompts: string[] = [];

  const server = new McpServer({ name: "Session Test", version: "0.0.0" });
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: canElicit ? { elicitation: {} } : {} }
  );

  if (canElicit) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      prompts.push(request.params.message);
      const answer = answers.shift();
      return answer == null
        ? { action: "cancel" as const }
        : { action: "accept" as const, content: { qea_path: answer } };
    });
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    session: new ModelSession(server, cliArg),
    prompts,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("remembered path", () => {
  it("survives a round trip and can be forgotten", () => {
    expect(readRememberedPath()).toBeUndefined();
    rememberPath(testDb.dbPath);
    expect(readRememberedPath()).toBe(testDb.dbPath);
    forgetPath();
    expect(readRememberedPath()).toBeUndefined();
  });

  it("treats a corrupt config file as no memory at all", () => {
    writeFileSync(join(process.env.EA_MCP_CONFIG_DIR!, "config.json"), "{ not json");
    expect(readRememberedPath()).toBeUndefined();
  });
});

describe("candidate order", () => {
  it("ranks the command line above the environment, and the environment above .env", () => {
    process.env.EA_QEA_PATH = "/from/env.qea";
    writeFileSync(join(sandbox, ".env"), "EA_QEA_PATH=/from/dotenv.qea\n");
    try {
      expect(listQeaPathCandidates("/from/cli.qea")).toEqual([
        { source: "argument", configured: "/from/cli.qea" },
        { source: "environment", configured: "/from/env.qea" },
        { source: "dotenv", configured: "/from/dotenv.qea" },
      ]);
    } finally {
      rmSync(join(sandbox, ".env"));
    }
  });

  it("is empty when nothing is configured", () => {
    expect(listQeaPathCandidates()).toEqual([]);
  });
});

describe("opening the model", () => {
  it("uses a configured path without asking", async () => {
    const { session, prompts, close } = await harness([], { cliArg: testDb.dbPath });
    await session.database();

    expect(prompts).toEqual([]);
    expect(session.origin()?.source).toBe("argument");
    await close();
  });

  it("asks when nothing is configured, and remembers the answer", async () => {
    const { session, prompts, close } = await harness([testDb.dbPath]);
    await session.database();

    expect(prompts).toHaveLength(1);
    expect(session.origin()?.source).toBe("prompt");
    expect(readRememberedPath()).toBe(testDb.dbPath);
    await close();
  });

  it("does not ask again once a path is remembered", async () => {
    rememberPath(testDb.dbPath);
    const { session, prompts, close } = await harness([]);
    await session.database();

    expect(prompts).toEqual([]);
    expect(session.origin()?.source).toBe("remembered");
    await close();
  });

  it("opens the model once when several tools ask at the same time", async () => {
    const { session, prompts, close } = await harness([testDb.dbPath]);
    const [a, b, c] = await Promise.all([
      session.database(),
      session.database(),
      session.database(),
    ]);

    expect(prompts).toHaveLength(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    await close();
  });
});

describe("a configured path that cannot be opened", () => {
  it("is skipped in favour of a working lower-priority source", async () => {
    process.env.EA_QEA_PATH = MISSING;
    rememberPath(testDb.dbPath);

    const { session, prompts, close } = await harness([]);
    await session.database();

    expect(prompts).toEqual([]);
    expect(session.origin()?.source).toBe("remembered");
    expect(session.origin()?.ignored).toEqual([
      { source: "environment", configured: MISSING, reason: expect.stringContaining("Path not found") },
    ]);
    await close();
  });

  it("leads to a prompt that explains itself, rather than a dead end", async () => {
    process.env.EA_QEA_PATH = MISSING;

    const { session, prompts, close } = await harness([testDb.dbPath]);
    await session.database();

    expect(prompts[0]).toContain("EA_QEA_PATH environment variable");
    expect(session.origin()?.source).toBe("prompt");
    await close();
  });

  // Skipping only earns its keep when an answer can replace what was skipped.
  it("is fatal when it came from the command line, however good the alternatives look", async () => {
    rememberPath(testDb.dbPath);

    const { session, prompts, close } = await harness([], { cliArg: MISSING });
    await expect(session.database()).rejects.toThrow(/Path not found/);

    expect(prompts).toEqual([]);
    await close();
  });

  it("is fatal when the client cannot be asked, instead of quietly opening another model", async () => {
    process.env.EA_QEA_PATH = MISSING;
    rememberPath(testDb.dbPath);

    const { session, close } = await harness([], { canElicit: false });
    await expect(session.database()).rejects.toThrow(/Path not found/);
    await close();
  });

  it("records the sources the winner outranked", async () => {
    process.env.EA_QEA_PATH = testDb.dbPath;
    rememberPath(MISSING);

    const { session, close } = await harness([]);
    await session.database();

    expect(session.origin()?.source).toBe("environment");
    expect(session.origin()?.shadowed).toEqual([{ source: "remembered", configured: MISSING }]);
    await close();
  });
});

describe("when the prompt does not produce a usable path", () => {
  it("reports the dismissal instead of hanging", async () => {
    const { session, close } = await harness([null]);
    await expect(session.database()).rejects.toThrow(/EA_QEA_PATH/);
    await close();
  });

  it("says so plainly when the client cannot prompt at all", async () => {
    const { session, prompts, close } = await harness([testDb.dbPath], { canElicit: false });
    await expect(session.database()).rejects.toThrow(/cannot prompt/);
    expect(prompts).toEqual([]);
    await close();
  });

  it("does not remember a wrong answer, and carries the reason into the next prompt", async () => {
    const { session, prompts, close } = await harness([MISSING, testDb.dbPath]);

    await expect(session.database()).rejects.toThrow(/Path not found/);
    expect(readRememberedPath()).toBeUndefined();

    await session.database();
    expect(prompts[1]).toContain("That path did not work");
    expect(readRememberedPath()).toBe(testDb.dbPath);
    await close();
  });

  // A path can exist and still not be a model, and that failure only surfaces on open.
  it("carries the reason forward when the answer exists but is not a model", async () => {
    const { session, prompts, close } = await harness([notAModel, testDb.dbPath]);

    await expect(session.database()).rejects.toThrow(/not a valid Enterprise Architect export/);
    expect(readRememberedPath()).toBeUndefined();

    await session.database();
    expect(prompts[1]).toContain("That path did not work");
    expect(prompts[1]).toContain("not a valid Enterprise Architect export");
    await close();
  });

  it("asks again for a later pair of concurrent calls", async () => {
    const { session, prompts, close } = await harness([null, testDb.dbPath]);

    await expect(session.database()).rejects.toThrow();
    await Promise.all([session.database(), session.database()]);

    expect(prompts).toHaveLength(2);
    await close();
  });
});

/**
 * The server promises structured JSON in every response. A missing model is the one
 * failure that happens outside a tool's own error handling, so it is the one most
 * likely to answer in prose without anyone noticing.
 */
describe("a tool call with no model available", () => {
  it("answers with structured JSON, not a sentence", async () => {
    const server = new McpServer({ name: "No Model", version: "0.0.0" });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    configureAllTools(server, new ModelSession(server));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "ea_get_model_info", arguments: {} });
    expect(result.isError).toBe(true);

    const payload = JSON.parse((result.content as any[])[0].text);
    expect(payload.error).toBe("no_model");
    expect(payload.howToConfigure).toContain("EA_QEA_PATH");

    await client.close();
    await server.close();
  });
});
