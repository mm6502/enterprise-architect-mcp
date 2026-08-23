---
title: "TypeScript MCP server architecture for read-only SQLite database access"
date: 2026-06-30
category: architecture-patterns
module: server
problem_type: architecture_pattern
component: mcp-server
severity: high
applies_when:
  - Building an MCP server that exposes structured data from a SQLite database to AI agents
  - Data is read-only (exports, analysis files, logs, archives)
  - The database is large (100MB+) and needs efficient repeated querying
  - You want a flat, maintainable structure that scales with tool count
tags:
  - mcp
  - architecture
  - sqlite
  - typescript
  - tool-registration
  - read-only
---

# TypeScript MCP server architecture for read-only SQLite database access

## Context

Building an MCP server for AI agents to query structured data from large SQLite files requires several architectural decisions: connection lifecycle, tool organization, error handling patterns, and how to guide agents on tool usage. The enterprise-architect-mcp server (querying multi-hundred-megabyte EA model exports with tens of thousands of elements, connectors, and packages) established patterns that generalize to any read-only SQLite MCP server.

## Guidance

### Overall architecture

```plaintext
CLI (yargs) → create server → configure tools → connect transport → (first tool call) resolve path → open DB once
```

```typescript
// src/index.ts — thin orchestration layer
const server = new McpServer(
  { name: "...", version: packageVersion },
  { instructions: `...usage guidance for agents...` }
);

// Holds the path chain and the one connection; opens nothing until a tool asks.
const session = new ModelSession(server, argv["qea-path"] as string | undefined);

configureAllTools(server, session);
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Key structural decisions

**1. Single long-lived DB connection, opened on the first tool call:**

Open the database once, validate immediately, configure cache, share the handle across all tools. No connection pooling needed for read-only synchronous access. Opening it lazily rather than during boot costs one shared promise (so concurrent first calls do not open it twice) and buys the ability to ask the user for the path — see the elicitation note in `docs/solutions/tooling-decisions/vscode-mcp-install-surfaces-configuration.md`.

```typescript
// src/database.ts
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true });

  // Fail fast: validate it's the expected schema
  db.prepare("SELECT COUNT(*) FROM t_object").get();

  // Performance: 64MB cache for large files
  db.exec("PRAGMA cache_size = -64000");

  return db;
}
```

**2. Flat tool modules with `configureXxxTools(server, model)` pattern**

Each domain gets one file that exports a single registration function, taking the session rather than a raw handle so registration stays synchronous while opening stays lazy. Central `tools.ts` wires them together. No classes, no inheritance — just functions.

```plaintext
src/
  index.ts          — CLI + orchestration
  database.ts       — connection + validation
  model-session.ts  — path chain + lazy open
  tools.ts          — central registration
  tools/
    search.ts       — configureSearchTools(server, model)
    elements.ts     — configureElementTools(server, model)
    connectors.ts   — configureConnectorTools(server, model)
    packages.ts     — configurePackageTools(server, model)
    diagrams.ts     — configureDiagramTools(server, model)
    scenarios.ts    — configureScenarioTools(server, model)
```

**3. Server instructions field for agent guidance:**

The `McpServer` constructor accepts an `instructions` string that guides agents on when to use (and not use) the tools. This is the single most impactful pattern for correct tool usage.

```typescript
const server = new McpServer(
  { name: "...", version: "..." },
  {
    instructions: `Use ea_* tools when the user asks about:
- Business analysis, use cases, requirements, domain model elements
- How elements relate to each other (connectors)

Do NOT use ea_* tools for:
- Azure DevOps work items (use ado server instead)
- Source code or deployments

Typical workflow: ea_search → ea_get_element → ea_get_connectors`
  }
);
```

**4. Consistent error handling per tool:**

Every tool wraps its logic in try/catch and returns `{ isError: true }` with descriptive messages. Never throw — always return structured errors.

```typescript
server.tool("ea_get_element", "...", schema, READ_ONLY, async (params) => {
  const db = await model.database();   // outside the try: a missing model is already structured
  try {
    const result = db.prepare(`...`).get(params.id);
    if (!result) {
      return { content: [{ type: "text", text: `Not found: ${params.id}` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});
```

**5. Validate once, on open — not per query:**

Check file existence → open database → verify expected tables exist, all inside `openDatabase`. Every later query trusts that result instead of re-checking.

This was originally phrased as *fail fast at startup*, and that half no longer holds: a server that dies before it can talk cannot ask the user where the model is, and cannot report why it gave up. The validation is unchanged and still happens exactly once; only its timing moved to the first tool call. A server that boots unconditionally has to earn back what fail-fast gave away for free:

- Log the resolved candidates at startup anyway, so a misconfiguration is visible before anyone runs a tool.
- Make the failure structured (see 4) — it now arrives as a tool result, not a crash, so it must be as parseable as a success.
- Report the provenance of the path that did open, because a lazy chain can end up on a different source than the operator expected.

## Why This Matters

MCP servers for database access have a recurring structure. Establishing these patterns once means:

- New tool modules are copy-paste scaffolding (5 min to add a tool)
- Error handling is consistent — agents get predictable error shapes
- Performance is solved once (cache, shared connection) not per-tool
- Server instructions prevent 80% of misuse without tool-level guard rails

## When to Apply

- Any MCP server that wraps a SQLite database (exports, archives, logs, analysis files)
- Read-only workloads (if writes are needed, add transaction management to `database.ts`)
- TypeScript/ESM projects using `@modelcontextprotocol/sdk`
- Servers with 3+ tools that share a database connection

## Examples

Adding a new tool module takes ~30 lines:

```typescript
// src/tools/tags.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "../database.js";
import { z } from "zod";

export function configureTagTools(server: McpServer, db: Database): void {
  server.tool(
    "ea_get_tagged_values",
    "Get tagged values for an element",
    { elementId: z.coerce.number() },
    async ({ elementId }) => {
      try {
        const rows = db.prepare(`
          SELECT Property, Value FROM t_objectproperties WHERE Object_ID = ?
        `).all(elementId);
        return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
```

Then register in `tools.ts`:

```typescript
import { configureTagTools } from "./tools/tags.js";
// ... in configureAllTools:
configureTagTools(server, db);
```
